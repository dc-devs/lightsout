import { buildUnitTestWriterInvocation } from '@/agents';
import { WorkReportStatus, type WorkReport } from '@/contracts';
import { appendFriction } from '@/runState';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import { testWriterConcurrency } from '@/pipeline/common/constants/testWriterConcurrency';

interface Params {
	run: PipelineRun;
	/** One import-graph group per writer — disjoint file sets, so writers cannot collide on disk. */
	groups: string[][];
	planContent: string;
	testStandards?: string;
}

/** One writer's outcome, tagged with the group it covered. */
type WriterResult = Awaited<ReturnType<PipelineRun['invokeRole']>> & { group: string[] };

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
		const label = result.group.join(', ');

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

/**
 * Fan the unit-test writers out over their groups, in batches of
 * `testWriterConcurrency`.
 *
 * The first group is spawned alone as a warm-up and the rest are held until it
 * emits its first stream event — the moment its response begins is the moment
 * the harness's prompt cache holds the writers' shared system prompt, so the
 * batch that follows reads the cache instead of paying for it five times over.
 * The gate is raced against the warm spawn settling, so a spawn that dies or
 * streams nothing (stub drivers) simply falls back to today's behavior.
 */
export const runWriterBatches = async ({
	run,
	groups,
	planContent,
	testStandards,
}: Params): Promise<{ reports: WorkReport[]; failures: string[]; terminated: boolean; parked: boolean }> => {
	const aggregate = createAggregate({ run });

	const spawnWriter = async ({ group, onFirstEvent }: { group: string[]; onFirstEvent?: () => void }) => ({
		group,
		...(await run.invokeRole({
			invocation: buildUnitTestWriterInvocation({ planContent, changedFiles: group, standards: testStandards }),
			step: 'write-tests',
			onFirstEvent,
		})),
	});

	// One spawn has nothing to warm for; zero groups skip everything below.
	const warmed = groups.length > 1;
	let warmSettled = false;
	let warmCollected = false;
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const warm = warmed
		? spawnWriter({ group: groups[0], onFirstEvent: release }).finally(() => {
				warmSettled = true;
			})
		: undefined;

	// Collected exactly once, wherever it resolves: before the batches when the
	// warm spawn settled first (a rate limit there must stop them), between
	// batches once it settles mid-run, or after the loop on the event path.
	const collectWarm = async () => {
		if (warm && !warmCollected) {
			warmCollected = true;

			await aggregate.collect({ result: await warm });
		}
	};

	if (warm) {
		await Promise.race([gate, warm.then(() => undefined, () => undefined)]);
	}

	const rest = warmed ? groups.slice(1) : groups;

	for (let start = 0; start < rest.length && !aggregate.isParked(); start += testWriterConcurrency) {
		if (warmSettled) {
			await collectWarm();
		}

		if (aggregate.isParked()) {
			break;
		}

		const results = await Promise.all(rest.slice(start, start + testWriterConcurrency).map((group) => spawnWriter({ group })));

		for (const result of results) {
			await aggregate.collect({ result });
		}
	}

	await collectWarm();

	return aggregate.result();
};
