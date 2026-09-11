import { readdir } from 'node:fs/promises';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import { loadPlanningProgressBlock } from '#src/cli/common/progressBlock/loadPlanningProgressBlock.ts';
import { loadShippingProgressBlock } from '#src/cli/common/progressBlock/loadShippingProgressBlock.ts';
import { printQueueStatus } from '#src/cli/common/queueBoard/printQueueStatus.ts';
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
 * `--planning <name>`: one plan's planning block, printed once. It is not a
 * run, so it has no run to name and nothing to repaint — beside `--run` or
 * `--watch`, or with no plan name, the request makes no sense and is refused
 * with the usage text. A missing or unreadable record is a normal answer.
 */
const printPlanningStatus = async ({ cwd, flags }: { cwd: string; flags: Map<string, string | true> }) => {
	const name = getStringFlag({ flags, name: 'planning' });

	if (name === undefined || flags.has('run') || flags.has('watch')) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	console.log('');

	for (const line of await loadPlanningProgressBlock({ cwd, name })) {
		console.log(line);
	}

	return exitCli({ code: 0 });
};

/**
 * `--shipping <branch>`: one branch's shipping block, read from the checkout
 * that ships it and printed once. Like `--planning` it is not a run: beside
 * `--run`, `--watch` or `--planning`, or with no branch, the request is refused
 * with the usage text. A missing or unreadable record is a normal answer.
 */
const printShippingStatus = async ({ cwd, flags }: { cwd: string; flags: Map<string, string | true> }) => {
	const branch = getStringFlag({ flags, name: 'shipping' });

	if (branch === undefined || flags.has('run') || flags.has('watch') || flags.has('planning')) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	console.log('');

	for (const line of await loadShippingProgressBlock({ cwd, branch })) {
		console.log(line);
	}

	return exitCli({ code: 0 });
};

/**
 * A run id the user typed is theirs to get wrong: an unknown one is a message,
 * never the stack of the manifest path we tried to open. The run form and the
 * queue form both resolve through here, so an unknown id has one answer.
 */
const resolveTypedRunId = ({ cwd, runId }: { cwd: string; runId: string }) =>
	resolveRunId({ cwd, runId }).catch((error: unknown) => {
		if (error instanceof RunNotFoundError) {
			console.error(error.message);
			return exitCli({ code: 1 });
		}

		throw error;
	});

/**
 * `--queue`: the queue's board and one status block per active ticket, printed
 * once. It takes `--run <id>` to name a queue run and nothing else: beside
 * `--watch`, `--planning` or `--shipping`, or carrying a value of its own, the
 * request is refused with the usage text.
 */
const printQueueForm = async ({ cwd, flags }: { cwd: string; flags: Map<string, string | true> }) => {
	if (flags.get('queue') !== true || flags.has('watch') || flags.has('planning') || flags.has('shipping')) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	const runFlag = getStringFlag({ flags, name: 'run' });
	const runId = runFlag === undefined ? undefined : await resolveTypedRunId({ cwd, runId: runFlag });

	return exitCli({ code: await printQueueStatus({ cwd, runId }) });
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
 *
 * `--planning <name>` shows a plan that is still being planned: the steps its
 * `lightsout plan` subcommands recorded in the plan folder, in the same block
 * layout as a run's, printed once. It stands alone — beside `--run` or
 * `--watch` it prints the usage text and exits 1.
 *
 * `--shipping <branch>` shows a branch that is being shipped: the six steps the
 * ship sequence recorded in the checkout that ships it, in the same layout,
 * printed once. It stands alone too — beside `--run`, `--watch` or
 * `--planning` it prints the usage text and exits 1.
 *
 * `--queue` shows a queue run: its seven-column board, then one fenced block
 * per active ticket holding exactly what `--run`, `--planning` or `--shipping`
 * prints for that ticket's worktree. It follows the live queue run the
 * checkout's run lock names, or the one `--run <id>` names, and prints once —
 * beside `--watch`, `--planning` or `--shipping` it prints the usage text and
 * exits 1.
 */
export const statusCommand = async ({ cwd, flags }: CommandContext): Promise<void> => {
	const runFlag = getStringFlag({ flags, name: 'run' });
	const watch = flags.get('watch') === true;

	if (flags.has('queue')) {
		return printQueueForm({ cwd, flags });
	}

	if (flags.has('shipping')) {
		return printShippingStatus({ cwd, flags });
	}

	if (flags.has('planning')) {
		return printPlanningStatus({ cwd, flags });
	}

	if (runFlag === undefined && !watch) {
		await printRunListing({ cwd });
		return exitCli({ code: 0 });
	}

	if (runFlag !== undefined) {
		const runId = await resolveTypedRunId({ cwd, runId: runFlag });

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
