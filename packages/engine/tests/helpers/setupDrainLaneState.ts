import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jest } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { GateHolds } from '#src/gates/index.ts';
import type { QueueDrainReport, TicketRunOutcome } from '#src/queue/index.ts';
import { queueOutcomeFixture } from '#tests/helpers/queueOutcomeFixture.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import type { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/** An idle scheduler ledger and controlled collaborators for direct lane tests. */
export const setupDrainLaneState = ({ maxParallel = 2 }: { maxParallel?: number } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-lane-state-'));
	const runTicket = jest
		.fn<(params: { ticket: ReturnType<typeof queueTicketFixture> }) => Promise<TicketRunOutcome>>()
		.mockImplementation(async ({ ticket }) => queueOutcomeFixture({ ticket }));
	const progress: string[] = [];
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
	/** No repository these lane tests stand up has ever timed out waiting for the machine. */
	const holds: GateHolds = {};
	const context = {
		cwd,
		config,
		runId: 'lane-drain-1',
		holds,
		settings: queueSettingsFixture({ maxParallel }),
		trackerSettings: trackerSettingsFixture(),
		shipSettings: shipSettingsFixture(),
		shipIntegration: shipIntegrationFixture(),
		defaultBranch: 'main',
		env: {},
		planPath: join(cwd, 'queue.md'),
		runTicket,
		serializeMainCheckout: <Result>({ task }: { task: () => Promise<Result> }) => task(),
		/** No lane helper records the board — the drain does, once per pass. */
		board: { record: () => undefined },
		onProgress: (message: string) => progress.push(message),
	};
	const state = {
		pending: [] as ReturnType<typeof queueTicketFixture>[],
		queued: [] as ReturnType<typeof queueTicketFixture>[],
		building: new Map<string, { ticket: ReturnType<typeof queueTicketFixture>; startedAt: string }>(),
		readyToShip: [] as TicketRunOutcome[],
		shipping: undefined as TicketRunOutcome | undefined,
		outcomes: [] as TicketRunOutcome[],
		leftBehind: [] as QueueDrainReport['leftBehind'],
		attempted: new Set<string>(),
		blockedByIdentifier: new Map<string, QueueDrainReport['leftBehind'][number]>(),
		retired: 0,
		rescanRequested: false,
		idleScanSpent: false,
		scansStopped: false,
	};
	const flight = { tasks: new Map<number, Promise<number>>(), builds: 0, ships: 0, scans: 0, nextKey: 0 };

	return { context, state, flight, runTicket, progress };
};
