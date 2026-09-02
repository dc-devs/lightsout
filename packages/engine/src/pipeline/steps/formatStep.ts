import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { runFormatter } from '#src/common/processes/runFormatter.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { PipelineStep } from '#src/pipeline/PipelineStep.ts';

interface Params {
	run: PipelineRun;
	id: string;
}

/** Format the full repository before the following verification step inspects it. */
export const formatStep = ({ run, id }: Params): PipelineStep => ({
	id,
	skip: () => (run.config.gates.format ? undefined : 'no format command configured'),
	run: async () => {
		const record = run.nextRecord({ id });

		await run.setStep({ record });
		run.progress(`step ${id} — running formatter`);

		const formatError = await runFormatter({ cwd: run.cwd, runId: run.current().runId, config: run.config, step: id });

		if (formatError) {
			return run.stop({ record, status: RunStatus.Failed, error: formatError });
		}

		const formatterArtifacts = ((await readGitChangedFiles({ cwd: run.cwd })) ?? []).filter(
			(file) => !run.current().changedFiles.includes(file) && !run.current().baselineDirtyFiles.includes(file),
		);

		await run.setStep({
			record: { ...record, status: RunStatus.Passed },
			patch: formatterArtifacts.length === 0 ? undefined : { baselineDirtyFiles: [...new Set([...run.current().baselineDirtyFiles, ...formatterArtifacts])] },
		});
		run.progress(`step ${id} passed`);

		return undefined;
	},
});
