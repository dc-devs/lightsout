import { RunStatus } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';

interface Params {
	run: PipelineRun;
	steps: PipelineStep[];
}

/**
 * Walk the steps in order, returning the result of the first one that stops the
 * run — or nothing at all when every step passed.
 *
 * This is where resume happens: a step the manifest already records as passed
 * is walked straight past, never re-run, so a run that parked at step five
 * re-enters and costs nothing for the first four. A step that has nothing to do
 * says so, and its reason is recorded as a pass rather than silently skipped —
 * the manifest has to explain the whole run, including the parts that did not
 * happen.
 */
export const runSteps = async ({ run, steps }: Params): Promise<PipelineResult | undefined> => {
	for (const step of steps) {
		const prior = run.current().steps.find((record) => record.id === step.id);

		if (prior?.status === RunStatus.Passed) {
			continue;
		}

		const skipReason = step.skip?.();

		if (skipReason) {
			await run.setStep({
				record: { id: step.id, status: RunStatus.Passed, attempts: prior?.attempts ?? 0, report: { skipped: skipReason } },
			});
			run.progress(`step ${step.id} skipped (${skipReason})`);

			continue;
		}

		const stopped = await step.run();

		if (stopped) {
			return stopped;
		}
	}

	return undefined;
};
