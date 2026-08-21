import { runFormatter } from '#src/common/processes/runFormatter.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';

interface Params {
	run: PipelineRun;
}

/** The formatter step: behavior-preserving by contract — verified anyway; a red gate here is a human's configuration problem, not an agent's. */
export const formatStep = ({ run }: Params): PipelineStep => ({
	id: 'format',
	skip: () => (run.config.gates.format ? undefined : 'no format command configured'),
	run: async () => {
		const record = run.nextRecord({ id: 'format' });

		await run.setStep({ record });
		run.progress('step format — running formatter');

		const formatError = await runFormatter({ cwd: run.cwd, runId: run.current().runId, config: run.config, step: 'format' });

		if (formatError) {
			return run.stop({ record, status: RunStatus.Failed, error: formatError });
		}

		const error = await runVerificationGates({ run, coverage: true });

		if (error) {
			return run.stop({
				record,
				status: RunStatus.Failed,
				error: `format: formatting broke verification — review the formatter/gate configuration.\n${error}`,
			});
		}

		// No changed-file merge here: the formatter only rewrites files the
		// run already tracks, and anything new it emits is artifact noise.
		await run.setStep({ record: { ...record, status: RunStatus.Passed } });
		run.progress('step format passed');

		return undefined;
	},
});
