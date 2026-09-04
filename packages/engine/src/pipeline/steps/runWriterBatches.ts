import { buildUnitTestWriterInvocation } from '#src/agents/index.ts';
import type { WorkReport } from '#src/contracts/index.ts';
import type { TestTargetGroup } from '#src/pipeline/common/types/TestTargetGroup.ts';
import type { WriterResult } from '#src/pipeline/common/types/WriterResult.ts';
import { createWarmSpawn } from '#src/pipeline/common/utils/createWarmSpawn.ts';
import { createWriterAggregate } from '#src/pipeline/common/utils/createWriterAggregate.ts';
import { drainChains } from '#src/pipeline/common/utils/drainChains.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
	/** One assignment per writer: subjects to test through, changed files that must execute. Same-cluster groups serialize. */
	groups: TestTargetGroup[];
	planContent: string;
	testStandards?: string;
	/** Repo-relative ledger test files the run locked — read-only for these writers. */
	ledgerTests?: string[];
}

/** Spawning one writer for one group, optionally gated on its first stream event. */
type SpawnWriter = ({ group, onFirstEvent }: { group: TestTargetGroup; onFirstEvent?: () => void }) => Promise<WriterResult>;

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
 * Fan the unit-test writers out over their groups: same-cluster groups run as
 * one serial chain, and chains occupy refilling slots (see `drainChains`). The
 * first chunk is spawned alone as a prompt-cache warm-up (see
 * `createWarmSpawn`) and the rest trail it.
 */
export const runWriterBatches = async ({
	run,
	groups,
	planContent,
	testStandards,
	ledgerTests,
}: Params): Promise<{ reports: WorkReport[]; failures: string[]; terminated: boolean; parked: boolean }> => {
	const aggregate = createWriterAggregate<TestTargetGroup>({ run, step: 'write-tests', label: ({ group }) => group.subjects.join(', ') });

	const spawnWriter: SpawnWriter = async ({ group, onFirstEvent }) => ({
		group,
		...(await run.invokeRole({
			invocation: buildUnitTestWriterInvocation({
				planContent,
				subjects: group.subjects,
				mustExecute: group.mustExecute,
				standards: testStandards,
				ledgerTests,
			}),
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

	await drainChains({ chains: restChains, aggregate, collectWarm, isSettled });

	await collectWarm();

	return aggregate.result();
};
