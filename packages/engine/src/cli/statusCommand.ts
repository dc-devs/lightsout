import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { usage } from '#src/cli/common/constants/usage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { loadPlanningProgressBlock } from '#src/cli/internal/common/progressBlock/loadPlanningProgressBlock.ts';
import { loadShippingProgressBlock } from '#src/cli/internal/common/progressBlock/loadShippingProgressBlock.ts';
import { printQueueStatus } from '#src/cli/internal/common/queueBoard/printQueueStatus.ts';
import { printRunProgress } from '#src/cli/internal/common/render/printRunProgress.ts';
import { printAmbiguousRuns } from '#src/cli/internal/common/runStatus/printAmbiguousRuns.ts';
import { printGoingRunStatus } from '#src/cli/internal/common/runStatus/printGoingRunStatus.ts';
import { printNewestRun } from '#src/cli/internal/common/runStatus/printNewestRun.ts';
import { resolveWatchTarget } from '#src/cli/internal/common/utils/resolveWatchTarget.ts';
import { watchRunProgress } from '#src/cli/internal/common/utils/watchRunProgress.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { resolveRunId } from '#src/runState/common/paths/resolveRunId.ts';
import { isRunLive } from '#src/runState/isRunLive.ts';
import { listRunIds } from '#src/runState/listRunIds.ts';
import { readRunProcessLock } from '#src/runState/lock/readRunProcessLock.ts';
import { RunNotFoundError } from '#src/runState/RunNotFoundError.ts';
import { readRunManifest } from '#src/runState/readRunManifest.ts';

/**
 * Every run this repo has state for, one line each — what `lightsout status`
 * has always printed, and still prints byte for byte when neither `--run` nor
 * `--watch` asks for anything narrower.
 */
const printRunListing = async ({ cwd }: { cwd: string }) => {
	const runIds = await listRunIds({ cwd });

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
 * once. It takes `--run <id>` to name a queue run and `--wait` to spend a
 * minute on a queue that has only just been launched: beside `--watch`,
 * `--planning`, `--shipping` or `--now`, or with a value after `--queue` or
 * `--wait`, the request is refused with the usage text.
 */
const printQueueForm = async ({ cwd, flags }: { cwd: string; flags: Map<string, string | true> }) => {
	const valued = flags.get('queue') !== true || (flags.has('wait') && flags.get('wait') !== true);
	const clash = flags.has('watch') || flags.has('planning') || flags.has('shipping') || flags.has('now');

	if (valued || clash) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	const runFlag = getStringFlag({ flags, name: 'run' });
	const runId = runFlag === undefined ? undefined : await resolveTypedRunId({ cwd, runId: runFlag });
	// Undefined rather than false when it was not typed, so the resolver is asked
	// only what the reader asked for.
	const wait = flags.has('wait') ? true : undefined;

	return exitCli({ code: await printQueueStatus({ cwd, runId, wait }) });
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
 * exits 1. `--wait` asks it to wait up to a minute for a queue that has only
 * just been launched, and is meaningless on every other form, so typed without
 * `--queue` it prints the usage text and exits 1.
 *
 * `--now` shows the run that is going, printed once and never repainted, and
 * for a phased plan both of its levels: the phase sequence, then the phase
 * moving now. It answers at once rather than waiting for a run to appear, falls
 * back to the newest run when nothing is going, and names several unrelated
 * running families back rather than guessing between them. It stands alone —
 * beside `--run`, `--watch`, `--planning`, `--shipping` or `--queue` it prints
 * the usage text and exits 1.
 */
export const statusCommand = async ({ cwd, flags }: CommandContext): Promise<void> => {
	const runFlag = getStringFlag({ flags, name: 'run' });
	const watch = flags.get('watch') === true;

	// One rule rather than a clause in each form: --wait waits for a queue run to
	// take the lock, which no other form is looking for.
	if (flags.has('wait') && !flags.has('queue')) {
		console.error(usage);
		return exitCli({ code: 1 });
	}

	if (flags.has('queue')) {
		return printQueueForm({ cwd, flags });
	}

	if (flags.has('now')) {
		return exitCli({ code: await printGoingRunStatus({ cwd, flags }) });
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
		printAmbiguousRuns({ roots: going.ambiguous });

		return exitCli({ code: 1 });
	}

	await (going === undefined ? printNewestRun({ cwd }) : watchRunProgress({ cwd, rootRunId: going.rootRunId }));

	return exitCli({ code: 0 });
};
