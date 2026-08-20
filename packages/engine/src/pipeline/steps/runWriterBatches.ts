import { buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import { type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { testWriterConcurrency } from '#src/pipeline/common/constants/testWriterConcurrency.ts';
import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { appendFriction } from '#src/runState/index.ts';

interface Params {
	run: PipelineRun;
	/** One assignment per writer: subjects to test through, changed files that must execute. Same-cluster groups serialize. */
	groups: TestTargetGroup[];
	planContent: string;
	testStandards?: string;
}

/** One writer's outcome, tagged with the group it covered. */
type WriterResult = Awaited<ReturnType<PipelineRun['invokeRole']>> & { group: TestTargetGroup };

/** Spawning one writer for one group, optionally gated on its first stream event. */
type SpawnWriter = ({ group, onFirstEvent }: { group: TestTargetGroup; onFirstEvent?: () => void }) => Promise<WriterResult>;

/**
 * The fan-out's running aggregate. Every writer result folds in here, wherever
 * it lands: a rate limit parks the run, an absent report is a failure, and a
 * report contributes its friction, its status, and its changed files.
 */
const createAggregate = ({ run }: { run: PipelineRun }) => {
	const reports: WorkReport[] = [];
	const failures: string[] = [];
	let terminated = false;
	let parked = false;

	const collect = async ({ result }: { result: WriterResult }) => {
		const label = result.group.subjects.join(', ');

		if (!result.ok) {
			if (result.rateLimited) {
				parked = true;
			} else {
				failures.push(`${label}: ${result.failure}`);
			}

			return;
		}

		const { report } = result;

		await appendFriction({ cwd: run.cwd, runId: run.current().runId, step: 'write-tests', friction: report.friction ?? [] });
		reports.push(report);
		run.progress(`write-tests: ${label} — ${report.status}`);

		if (report.status !== WorkReportStatus.Complete) {
			terminated = terminated || report.status !== WorkReportStatus.Failed;
			failures.push(`${label}: ${report.status} — ${report.failures.join('; ')}`);
		}
	};

	return { collect, isParked: () => parked, result: () => ({ reports, failures, terminated, parked }) };
};

// Groups sharing a cluster are chunks of ONE oversized component — their
// subjects may overlap, so two writers must never hold them concurrently.
// First-appearance order keeps chains[0][0] === groups[0].
const chainGroups = ({ groups }: { groups: TestTargetGroup[] }) => {
	const byCluster = new Map<string, TestTargetGroup[]>();

	for (const group of groups) {
		byCluster.set(group.cluster, [...(byCluster.get(group.cluster) ?? []), group]);
	}

	return [...byCluster.values()];
};

// One chain's chunks run strictly one after another; a rate-limited chunk
// stops its chain (the park itself is decided by the batch loop).
const runChain = async ({ chain, spawnWriter }: { chain: TestTargetGroup[]; spawnWriter: SpawnWriter }) => {
	const results: WriterResult[] = [];

	for (const group of chain) {
		const result = await spawnWriter({ group });

		results.push(result);

		if (!result.ok && result.rateLimited) {
			break;
		}
	}

	return results;
};

/**
 * The warm-up spawn and the gate holding the rest behind it. The first chunk
 * goes out alone and the others wait until it emits its first stream event —
 * the moment its response begins is the moment the harness's prompt cache
 * holds the writers' shared system prompt, so the batch that follows reads
 * the cache instead of paying for it five times over. The gate is raced
 * against the spawn settling, so one that dies or streams nothing (stub
 * drivers) simply falls back to unwarmed behavior. No group means nothing to
 * warm for, and every hook below turns into a no-op.
 */
const createWarmSpawn = ({
	group,
	spawnWriter,
	aggregate,
}: {
	group: TestTargetGroup | undefined;
	spawnWriter: SpawnWriter;
	aggregate: ReturnType<typeof createAggregate>;
}) => {
	let settled = false;
	let collected = false;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const warm =
		group === undefined
			? undefined
			: spawnWriter({ group, onFirstEvent: release }).finally(() => {
					settled = true;
				});

	// Collected exactly once, wherever it resolves: before the batches when the
	// warm spawn settled first (a rate limit there must stop them), between
	// batches once it settles mid-run, or after the loop on the event path.
	const collectWarm = async () => {
		if (warm && !collected) {
			collected = true;

			await aggregate.collect({ result: await warm });
		}
	};

	const awaitGate = async () => {
		if (warm) {
			await Promise.race([
				gate,
				warm.then(
					() => undefined,
					() => undefined,
				),
			]);
		}
	};

	return { warm, collectWarm, awaitGate, isSettled: () => settled };
};

/**
 * Fan the unit-test writers out over their groups: same-cluster groups run as
 * one serial chain, and chains occupy `testWriterConcurrency` slots that refill
 * the moment one frees. The first chunk is spawned alone as a prompt-cache
 * warm-up (see `createWarmSpawn`) and the rest trail it.
 *
 * Slots refill rather than draining in lockstep because writer durations are
 * wildly uneven — a group of one small module settles in seconds while an
 * oversized component's chunk runs for minutes. Waiting for a whole batch left
 * every other slot idle until its slowest member returned, which on a real
 * fan-out is most of the wall clock.
 */
export const runWriterBatches = async ({
	run,
	groups,
	planContent,
	testStandards,
}: Params): Promise<{ reports: WorkReport[]; failures: string[]; terminated: boolean; parked: boolean }> => {
	const aggregate = createAggregate({ run });

	const spawnWriter: SpawnWriter = async ({ group, onFirstEvent }) => ({
		group,
		...(await run.invokeRole({
			invocation: buildUnitTestWriterInvocation({ planContent, subjects: group.subjects, mustExecute: group.mustExecute, standards: testStandards }),
			step: 'write-tests',
			onFirstEvent,
		})),
	});

	// One spawn has nothing to warm for; zero groups skip everything below.
	const chains = chainGroups({ groups });
	const warmed = groups.length > 1;
	const { warm, collectWarm, awaitGate, isSettled } = createWarmSpawn({ group: warmed ? groups[0] : undefined, spawnWriter, aggregate });

	await awaitGate();

	// The warm spawn is the first chain's first chunk, so that chain's
	// remainder must still trail it — its runner waits for the warm spawn to
	// settle before spawning anything.
	const firstChainRest = warmed ? (chains[0]?.slice(1) ?? []) : [];
	const restChains: Array<() => Promise<WriterResult[]>> = [];

	if (warm && firstChainRest.length > 0) {
		restChains.push(async () => {
			const warmResult = await warm;

			return !warmResult.ok && warmResult.rateLimited ? [] : runChain({ chain: firstChainRest, spawnWriter });
		});
	}

	for (const chain of warmed ? chains.slice(1) : chains) {
		restChains.push(() => runChain({ chain, spawnWriter }));
	}

	// A warm spawn that already settled must be folded in BEFORE any slot opens:
	// when it rate-limited, the park flag it sets is what keeps the rest from
	// ever spawning.
	if (isSettled()) {
		await collectWarm();
	}

	// A shared cursor is what makes the slots refill: every runner takes the next
	// unclaimed chain and keeps going until the list is spent or the run parks.
	let next = 0;

	const runSlot = async (): Promise<void> => {
		while (next < restChains.length && !aggregate.isParked()) {
			const chain = restChains[next];

			next += 1;

			if (chain === undefined) {
				return;
			}

			const results = await chain();

			if (isSettled()) {
				await collectWarm();
			}

			for (const result of results) {
				await aggregate.collect({ result });
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(testWriterConcurrency, restChains.length) }, () => runSlot()));

	await collectWarm();

	return aggregate.result();
};
