import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { runVerificationGates } from '#src/pipeline/common/utils/runVerificationGates.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';

interface Params {
	run: PipelineRun;
}

/**
 * The clean-slate gate: the codebase must be green before implementation.
 * Coverage runs here too — verify-tests holds the same bar later, so a
 * baseline that already misses it must be the consumer's problem, not the
 * run's.
 */
export const cleanSlateStep = ({ run }: Params): PipelineStep['run'] => {
	return async () => {
		const record = run.nextRecord({ id: 'clean-slate' });

		await run.setStep({ record });
		run.progress(`step clean-slate — attempt ${record.attempts}`);

		const error = await runVerificationGates({ run, coverage: true });

		if (error) {
			return run.stop({
				record,
				status: RunStatus.Failed,
				error: `Codebase is not green before implementation — fix this first.\n${error}`,
			});
		}

		// Gate commands may produce artifacts (coverage output, logs). Fold
		// anything that appeared during clean-slate into the baseline so it is
		// never attributed to the run's agents.
		const gateArtifacts = await readGitChangedFiles({ cwd: run.cwd });

		await run.setStep({
			record: { ...record, status: RunStatus.Passed },
			patch: gateArtifacts ? { baselineDirtyFiles: [...new Set([...run.current().baselineDirtyFiles, ...gateArtifacts])] } : undefined,
		});
		run.progress('step clean-slate passed');

		return undefined;
	};
};
