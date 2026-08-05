import { RunStatus } from '@/contracts';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import type { PipelineRun } from '@/pipeline/PipelineRun';
import type { PipelineStep } from '@/pipeline/PipelineStep';
import { collectChanged } from '@/pipeline/common/utils/collectChanged';
import { sourceFiles } from '@/pipeline/common/utils/sourceFiles';
import { withStepFiles } from '@/pipeline/common/utils/withStepFiles';
import { testWriterConcurrency } from '@/pipeline/common/constants/testWriterConcurrency';
import { groupTestTargets } from '@/pipeline/steps/groupTestTargets';
import { runWriterBatches } from '@/pipeline/steps/runWriterBatches';
import { selectTestTargets } from '@/pipeline/steps/selectTestTargets';

interface Params {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	testStandards?: string;
}

/** The write-tests fan-out: one writer per import-graph group, batches in parallel — groups are disjoint file sets, so writers cannot collide on disk. */
export const writeTestsStep = ({ run, gitPrefix, planContent, testStandards }: Params): PipelineStep['run'] => {
	return async () => {
		let record = run.nextRecord({ id: 'write-tests' });

		await run.setStep({ record });

		const compiler = resolveConsumerTypescript({ cwd: run.cwd, packagesDir: run.config.packagesDir ?? 'packages' });
		const { targets, inert, deleted } = await selectTestTargets({ run, candidates: sourceFiles({ run }), compiler });

		if (deleted.length > 0) {
			run.progress(`write-tests: ${deleted.length} deleted file(s) skipped (removed by the plan, nothing to cover): ${deleted.join(', ')}`);
		}

		if (inert.length > 0) {
			run.progress(`write-tests: ${inert.length} inert file(s) skipped (barrel/type-only, nothing to cover): ${inert.join(', ')}`);
		}

		const groups = await groupTestTargets({ run, targets, compiler });

		run.progress(
			`step write-tests — attempt ${record.attempts} · ${groups.length} group(s) across ${targets.length} file(s) (import-graph), up to ${testWriterConcurrency} writers in parallel`,
		);
		const { reports, failures, terminated, parked } = await runWriterBatches({ run, groups, planContent, testStandards });

		// Persist whatever progress the batches made before deciding the
		// outcome — a parked or stopped run must still know what was touched.
		record = withStepFiles({ record, reports, gitPrefix });

		await run.setStep({ record: { ...record, report: { reports } }, patch: await collectChanged({ run, gitPrefix, reports }) });

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
