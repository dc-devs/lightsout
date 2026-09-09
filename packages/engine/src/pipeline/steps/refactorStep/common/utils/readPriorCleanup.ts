import { RefactorStepReport } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The cleanup record a previous session of this step left on the manifest, or
 * `undefined` when there is none to read.
 *
 * `undefined` rather than a throw for a record an older engine wrote, exactly
 * as `readStandardsSnapshot` treats an unreadable snapshot: this runs on a
 * resume, where refusing to parse would strand the run for the sake of evidence
 * that is optional in the first place.
 */
export const readPriorCleanup = ({ run }: Params): RefactorStepReport | undefined => {
	return RefactorStepReport.safeParse(run.current().steps.find((step) => step.id === 'refactor')?.report).data;
};
