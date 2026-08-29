import { readdir } from 'node:fs/promises';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { PipelineKind, RunStatus } from '#src/contracts/index.ts';
import { getRunsDir, isRunLive, readRunLock, readRunManifest } from '#src/runState/index.ts';

export const statusCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const runIds = await readdir(getRunsDir({ cwd })).catch(() => []);

	if (runIds.length === 0) {
		console.log('no runs found');
		return exitCli({ code: 0 });
	}

	const lock = await readRunLock({ cwd });

	for (const runId of runIds) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest) {
			// A `running` manifest with no live process behind it is a crash
			// leftover (killed terminal, uncaught error) — resumable, not lost.
			const zombie = manifest.status === RunStatus.Running && !isRunLive({ manifest, lock });
			const status = zombie ? `${manifest.status} (no live process — crashed? resume with --run ${manifest.runId})` : manifest.status;
			const phases =
				manifest.pipeline === PipelineKind.Phases
					? `  phases: ${manifest.steps.filter((step) => step.status === RunStatus.Passed).length}/${manifest.steps.length}`
					: '';

			// A run built from a ticket rather than a plan says which ticket, so a
			// queue's parked work is findable from the run list alone.
			const ticket = manifest.ticketRef === undefined ? '' : `  ticket: ${manifest.ticketRef}`;

			console.log(`${manifest.runId}  ${status}  plan: ${manifest.plan}${ticket}${phases}  updated: ${manifest.updatedAt}`);
		}
	}

	return exitCli({ code: 0 });
};
