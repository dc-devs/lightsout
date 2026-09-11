import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { jest } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { QueueDrainReport, QueueFailure, TicketRunOutcome } from '#src/queue/index.ts';
import { createControlledQueueLane } from '#tests/helpers/createControlledQueueLane.ts';
import { createQueueCheckoutLog } from '#tests/helpers/createQueueCheckoutLog.ts';
import { drainLaneOutcomeFixture } from '#tests/helpers/drainLaneOutcomeFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

type RunnableTicket = ReturnType<typeof queueTicketFixture>;
type LeftBehindTicket = QueueDrainReport['leftBehind'][number];
type WaveSelection = { runnable: RunnableTicket[]; blocked: LeftBehindTicket[]; skipped: LeftBehindTicket[] };

/** Runs a task with no other main-checkout git mutation in flight. */
type SerializeMainCheckout = <Result>(params: { task: () => Promise<Result> }) => Promise<Result>;
type ShipParams = { outcome: TicketRunOutcome; serializeMainCheckout: SerializeMainCheckout };
type ScanParams = { attempted: Set<string> };
type ReconcileParams = { tickets: RunnableTicket[] };

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/** A drain whose builders and merges the test resolves by hand, so it can assert a merge happened while a build was still open. */
export const setupDrainLanes = ({
	mocks,
	serializeMainCheckout,
	runnable = [],
	blocked = [],
	carriedLeftBehind = [],
	maxParallel = 2,
}: {
	serializeMainCheckout: SerializeMainCheckout;
	mocks: {
		ship: jest.Mock<(params: ShipParams) => Promise<TicketRunOutcome>>;
		scan: jest.Mock<(params: ScanParams) => Promise<WaveSelection | QueueFailure>>;
		reconcile: jest.Mock<(params: ReconcileParams) => Promise<{ kept: RunnableTicket[]; leftBehind: LeftBehindTicket[] }>>;
	};
	runnable?: string[];
	blocked?: LeftBehindTicket[];
	carriedLeftBehind?: LeftBehindTicket[];
	maxParallel?: number;
}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-lanes-'));
	const planPath = join(cwd, 'queue.md');
	let laneActivity = 0;
	const checkout = createQueueCheckoutLog({
		onActivity: () => {
			laneActivity += 1;
		},
	});
	const progress: string[] = [];
	let inFlight = 0;
	let peakInFlight = 0;
	const enter = () => {
		laneActivity += 1;
		inFlight += 1;
		peakInFlight = Math.max(peakInFlight, inFlight);
	};
	const leave = () => {
		laneActivity += 1;
		inFlight -= 1;
	};
	const builds = createControlledQueueLane({ enter, leave });
	const merges = createControlledQueueLane({ enter, leave });

	mocks.reconcile.mockImplementation(({ tickets }) => Promise.resolve({ kept: tickets, leftBehind: [] }));
	mocks.scan.mockResolvedValue({ runnable: [], blocked: [], skipped: [] });
	mocks.ship.mockImplementation(async (params) => {
		const identifier = params.outcome.ticket.identifier;
		const answer = await merges.begin({ identifier });

		// The merge tail removes the ticket's worktree from the main checkout.
		await params.serializeMainCheckout({ task: () => checkout.mutate({ label: `remove ${identifier}` }) });

		return answer;
	});

	// What a builder does first: add this ticket's worktree to the main checkout.
	const runTicket = ({ ticket }: { ticket: RunnableTicket }) => {
		const built = builds.begin({ identifier: ticket.identifier });

		return serializeMainCheckout({ task: () => checkout.mutate({ label: `add ${ticket.identifier}` }) }).then(() => built);
	};

	/**
	 * Yield until the drain has stopped moving.
	 *
	 * A fixed count of event-loop turns is not enough, and counting them is what
	 * made these cases pass on a fast laptop and fail on CI. The drain awaits a
	 * real `writeFile` for the coordinator's queue document, and that completes on
	 * libuv's thread pool rather than after some number of turns — on a loaded
	 * machine the turns run out while the write is still queued, and the test then
	 * looks at a drain that has not reached its next decision yet.
	 *
	 * So this waits for real quiet instead: the lanes unchanged across several
	 * timer yields, each of which gives the thread pool wall-clock time rather than
	 * spinning the loop past it. The iteration cap keeps a genuinely stuck drain to
	 * a bounded wait rather than the suite's timeout.
	 */
	const settle = async () => {
		let quiet = 0;
		let last = laneActivity;

		for (let turn = 0; turn < 400 && quiet < 8; turn += 1) {
			await new Promise((resolve) => setTimeout(resolve, 0));
			quiet = laneActivity === last ? quiet + 1 : 0;
			last = laneActivity;
		}
	};

	let finished = false;

	const carried: TicketRunOutcome[] = [];
	const params = {
		cwd,
		config,
		runId: 'drain-lanes-1',
		holds: {},
		settings: queueSettingsFixture({ maxParallel }),
		trackerSettings: trackerSettingsFixture(),
		shipSettings: shipSettingsFixture(),
		shipIntegration: shipIntegrationFixture(),
		defaultBranch: 'main',
		env: {},
		planPath,
		first: {
			runnable: runnable.map((identifier) => queueTicketFixture({ identifier, id: `id-${identifier}`, title: `Ticket ${identifier}` })),
			blocked,
			skipped: [],
		},
		carried,
		carriedLeftBehind,
		attempted: new Set<string>(),
		runTicket,
		serializeMainCheckout,
		/** A board that keeps nothing — a test about the board passes its own recorder in its place. */
		board: { record: () => undefined },
		onProgress: (message: string) => progress.push(message),
	};

	/** Track the subject promise so release-all waits for the complete drain. */
	const trackDrain = (drained: Promise<QueueDrainReport>) => {
		drained
			.finally(() => {
				finished = true;
			})
			.catch(() => undefined);

		return drained;
	};

	/** End one ticket on a lane: wait for the drain to have started it — a release by name before then would release nothing — then release it and let the drain react. */
	const finisherFor = (lane: ReturnType<typeof createControlledQueueLane>) => async (params: Parameters<typeof drainLaneOutcomeFixture>[0]) => {
		await lane.untilStarted({ identifier: params.identifier });
		lane.release({ identifier: params.identifier, outcome: drainLaneOutcomeFixture(params) });

		await settle();
	};

	/**
	 * Let everything in flight finish as merged, turn after turn, until the drain
	 * answers.
	 *
	 * Idle lanes are not the end: the drain starts its first builds only after a
	 * queue-document write, and every admission is followed by another, so a loop
	 * that stopped at the first quiet moment would leave a build to begin after
	 * nobody is releasing anything. The cap keeps a drain that never answers to a
	 * named failure rather than the suite's timeout.
	 */
	const finishEverything = async () => {
		for (let turn = 0; turn < 500 && !finished; turn += 1) {
			for (const lane of [builds, merges]) {
				for (const identifier of lane.running()) {
					lane.release({ identifier, outcome: drainLaneOutcomeFixture({ identifier }) });
				}
			}

			await settle();
		}

		if (!finished) {
			throw new Error('the drain never answered while every ticket it started was being released');
		}
	};

	return {
		builds,
		checkout,
		params,
		trackDrain,
		finishBuild: finisherFor(builds),
		finishEverything,
		finishMerge: finisherFor(merges),
		merges,
		peakInFlight: () => peakInFlight,
		planPath,
		progress,
		serializeMainCheckout,
		settle,
	};
};
