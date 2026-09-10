import { readdir } from 'node:fs/promises';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printRunProgress } from '#src/cli/common/render/printRunProgress.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveWatchTarget } from '#src/cli/common/utils/resolveWatchTarget.ts';
import { watchRunProgress } from '#src/cli/common/utils/watchRunProgress.ts';
import { PipelineKind, RunStatus } from '#src/contracts/index.ts';
import { getRunsDir, isRunLive, RunNotFoundError, readRunManifest, readRunProcessLock, resolveRunId } from '#src/runState/index.ts';
import { listRuns } from '#src/views/index.ts';

/**
 * Every run this repo has state for, one line each — what `lightsout status`
 * has always printed, and still prints byte for byte when neither `--run` nor
 * `--watch` asks for anything narrower.
 */
const printRunListing = async ({ cwd }: { cwd: string }) => {
	const runIds = await readdir(getRunsDir({ cwd })).catch(() => []);

	if (runIds.length === 0) {
		console.log('no runs found');
		return;
	}

	for (const runId of runIds) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest) {
			// Taken per run rather than once: the run lock is per-checkout, so an
			// isolated run's holder is in the workspace it recorded rather than here.
			const lock = await readRunProcessLock({ cwd, manifest });
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
};

/**
 * A bare `--watch` in a repo where nothing is going: the newest run of any
 * status, painted once, so a terminal user still sees the last run instead of
 * a minute of silence and a false claim that there are none.
 */
const printNewestRun = async ({ cwd }: { cwd: string }) => {
	const newest = (await listRuns({ cwd }))[0]?.runId;

	if (newest === undefined) {
		console.log('no runs found');
		return;
	}

	await printRunProgress({ cwd, runId: newest });
};

/**
 * `lightsout status` — which runs this repo has, or what is happening inside
 * one of them.
 *
 * The bare listing is unchanged and always will be: scripts read it, and it is
 * the only view that answers "which runs exist" without opening any of them.
 * `--run <id>` opens one, taking the shortened eight-character id reports
 * print; `--watch` repaints that block every two minutes until the run stops,
 * which is how a detached run gets followed at all. Both detailed blocks
 * include persisted verification diagnostics through `printRunProgress`.
 *
 * A `--watch` with no `--run` follows the one run that is going, and its phase
 * children with it. Several unrelated runs going at once are named back to the
 * reader to pick between rather than guessed at, because narrating somebody
 * else's concurrent work is worse than asking which one they meant.
 */
export const statusCommand = async ({ cwd, flags }: CommandContext): Promise<void> => {
	const runFlag = getStringFlag({ flags, name: 'run' });
	const watch = flags.get('watch') === true;

	if (runFlag === undefined && !watch) {
		await printRunListing({ cwd });
		return exitCli({ code: 0 });
	}

	if (runFlag !== undefined) {
		// A run id the user typed is theirs to get wrong: an unknown one is a
		// message, never the stack of the manifest path we tried to open.
		const runId = await resolveRunId({ cwd, runId: runFlag }).catch((error: unknown) => {
			if (error instanceof RunNotFoundError) {
				console.error(error.message);
				return exitCli({ code: 1 });
			}

			throw error;
		});

		await (watch ? watchRunProgress({ cwd, runId }) : printRunProgress({ cwd, runId }));

		return exitCli({ code: 0 });
	}

	// The one call that spends the full grace period, waiting for a run the
	// caller has only just started to write its first manifest. From here the
	// watch re-resolves its own target every frame, inside the family it started.
	const going = await resolveWatchTarget({ cwd });

	if (going !== undefined && 'ambiguous' in going) {
		// Naming the ids rather than guessing: an unrelated concurrent run narrated
		// in place of the one the reader started is worse than being asked.
		console.error(`several runs are going: ${going.ambiguous.join(', ')}`);
		console.error('pick one with --run <id>');

		return exitCli({ code: 1 });
	}

	await (going === undefined ? printNewestRun({ cwd }) : watchRunProgress({ cwd, rootRunId: going.rootRunId }));

	return exitCli({ code: 0 });
};
