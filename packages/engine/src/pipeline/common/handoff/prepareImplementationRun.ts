import { readGitChangedFiles } from '#src/common/git/readGitChangedFiles.ts';
import { toRepoRelativePath } from '#src/common/utils/toRepoRelativePath.ts';
import { PipelineKind, RunStatus } from '#src/contracts/index.ts';
import { readHandoffPrerequisites } from '#src/pipeline/common/handoff/readHandoffPrerequisites.ts';
import { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { preparePlanningHandoff } from '#src/plan/index.ts';
import { createRun } from '#src/runState/index.ts';

export const prepareImplementationRun = async ({
	cwd,
	runId,
	driver,
	config,
	planPath,
	overviewPath,
	parentRunId,
	existing,
	willShip,
	onProgress,
	planningHandoff,
}: Parameters<typeof runImplementPipeline>[0] & { runId: string }): Promise<PipelineRun> => {
	if (planningHandoff && !existing && !parentRunId) throw new Error('An inherited handoff requires its owning coordinator');
	const handoff = await preparePlanningHandoff({ cwd, config, plan: planPath ?? '', existing, inherited: planningHandoff });
	const prerequisites = await readHandoffPrerequisites({
		cwd,
		plan: existing?.plan ?? toRepoRelativePath({ cwd, path: planPath ?? '' }),
		parentRunId: existing?.parentRunId ?? parentRunId,
		handoff,
	});
	const run = new PipelineRun({
		cwd,
		config,
		driver,
		onProgress,
		manifest:
			existing ??
			(await createRun({
				cwd,
				runId,
				plan: planPath ?? '',
				pipeline: PipelineKind.Implement,
				overview: overviewPath,
				parentRunId,
				driver: driver.name,
				config,
				baselineDirtyFiles: await readGitChangedFiles({ cwd }),
				willShip,
				planningHandoff: handoff,
			})),
	});
	if (handoff) {
		const current = run.current();
		await run.update({
			patch: {
				acceptanceTests: existing ? current.acceptanceTests : prerequisites,
				...(existing
					? {
							changedFiles: [...new Set([...current.changedFiles, ...((await readGitChangedFiles({ cwd })) ?? [])])],
							steps: current.steps.map((step) =>
								step.status === RunStatus.Passed && (step.id.startsWith('verify-') || step.id.startsWith('format-'))
									? { ...step, status: RunStatus.Pending, verification: undefined }
									: step,
							),
						}
					: {}),
			},
		});
	}
	return run;
};
