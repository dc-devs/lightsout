import { defaultPackagesDir } from '@/common/constants/defaultPackagesDir';
import { listSourceFiles } from '@/common/utils/listSourceFiles';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { RunStatus } from '@/contracts';
import { testWriterConcurrency } from '@/pipeline/common/constants/testWriterConcurrency';
import { collectChanged } from '@/pipeline/common/utils/collectChanged';
import { resolveTestSubjects } from '@/pipeline/common/utils/resolveTestSubjects';
import { sourceFiles } from '@/pipeline/common/utils/sourceFiles';
import { withStepFiles } from '@/pipeline/common/utils/withStepFiles';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import type { PipelineStep } from '@/pipeline/PipelineStep';
import { groupTestTargets } from '@/pipeline/steps/groupTestTargets';
import { runWriterBatches } from '@/pipeline/steps/runWriterBatches';
import { selectTestTargets } from '@/pipeline/steps/selectTestTargets';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	testStandards?: string;
}

/** The write-tests fan-out: changed files resolve up to their public subjects, one writer per import-graph group — groups' subjects are disjoint across clusters, so parallel writers cannot collide on disk. */
export const writeTestsStep = ({ run, gitPrefix, planContent, testStandards }: Params): PipelineStep['run'] => {
	return async () => {
		let record = run.nextRecord({ id: 'write-tests' });

		await run.setStep({ record });

		const packagesDir = run.config.packagesDir ?? defaultPackagesDir;
		const compiler = resolveConsumerTypescript({ cwd: run.cwd, packagesDir });
		const { targets, inert, deleted } = await selectTestTargets({ run, candidates: sourceFiles({ run }), compiler });

		if (deleted.length > 0) {
			run.progress(`write-tests: ${deleted.length} deleted file(s) skipped (removed by the plan, nothing to cover): ${deleted.join(', ')}`);
		}

		if (inert.length > 0) {
			run.progress(`write-tests: ${inert.length} inert file(s) skipped (barrel/type-only, nothing to cover): ${inert.join(', ')}`);
		}

		const universe = (await listSourceFiles({ cwd: run.cwd, exclude: run.config.generated })).files;
		const { subjects, orphans } = await resolveTestSubjects({ cwd: run.cwd, targets, universe, packagesDir, compiler });

		if (orphans.length > 0) {
			run.progress(
				`write-tests: ${orphans.length} changed file(s) skipped — nothing public reaches them (no barrel exports a surface that imports them): ${orphans.join(', ')}`,
			);
		}

		const testSubjects = [...new Set([...subjects.values()].flat())].sort();

		// Persisted before any writer spawns — a crash mid-fan-out must not lose
		// the skip record or the subjects a verify fix re-invocation hands back.
		await run.setStep({ record, patch: { testSubjects, unreachableChangedFiles: orphans } });

		const groups = await groupTestTargets({ run, subjects, compiler });

		run.progress(
			`step write-tests — attempt ${record.attempts} · ${groups.length} group(s): ${testSubjects.length} subject(s) covering ${subjects.size} changed file(s), up to ${testWriterConcurrency} writers in parallel`,
		);
		const { reports, failures, terminated, parked } = await runWriterBatches({ run, groups, planContent, testStandards });

		// Persist whatever progress the batches made before deciding the
		// outcome — a parked or stopped run must still know what was touched.
		record = withStepFiles({ record, reports, gitPrefix });

		await run.setStep({
			record: { ...record, report: { reports } },
			patch: { ...(await collectChanged({ run, gitPrefix, reports })), testSubjects, unreachableChangedFiles: orphans },
		});

		if (parked) {
			return run.stop({ record: { ...record, report: { reports } }, status: RunStatus.PausedRateLimit, error: run.parkMessage() });
		}

		if (failures.length > 0) {
			return run.stop({
				record: { ...record, report: { reports } },
				status: terminated ? RunStatus.Escalated : RunStatus.Failed,
				error: `write-tests: ${failures.length} of ${groups.length} writer(s) did not complete:\n${failures.join('\n')}`,
			});
		}

		await run.setStep({ record: { ...record, status: RunStatus.Passed, report: { reports } } });
		run.progress('step write-tests passed');

		return undefined;
	};
};
