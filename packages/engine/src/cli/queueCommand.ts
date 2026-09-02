import { resolve } from 'node:path';
import { pausedExitCode } from '#src/cli/common/constants/pausedExitCode.ts';
import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import {
	emptyRelayMailbox,
	FileQuestionRelay,
	type QuestionRelay,
	type QueueDrainReport,
	type QueueSettings,
	resolveQueueSettings,
	runQueue,
	TerminalQuestionRelay,
} from '#src/queue/index.ts';
import { isPidAlive, readRunLock } from '#src/runState/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { resolveTrackerSettings, type TrackerSettings } from '#src/ticketTracker/index.ts';

/** One line per ticket the drain touched, and one per ticket it deliberately did not — a ticket must never vanish from the summary. */
const printDrainReport = ({ report }: { report: QueueDrainReport }) => {
	for (const outcome of report.outcomes) {
		if (outcome.ready) {
			console.log(`${outcome.ticket.identifier} ${outcome.branch} shipped`);
		} else {
			console.log(`${outcome.ticket.identifier} ${outcome.branch} parked: ${outcome.error ?? 'no reason recorded'}`);
			console.log(`  worktree: ${outcome.worktreePath}`);
		}
	}

	for (const entry of report.leftBehind) {
		console.log(`${entry.identifier} ${entry.reason}`);
	}
};

/**
 * The relay the drain will use: this terminal by default, or the mailbox when
 * `--file-relay` was passed.
 *
 * The flag's value is optional, so `parseFlags` hands back `true` for a bare
 * `--file-relay` and the directory string when one followed it — a bare flag
 * means the default mailbox under `.lightsout/queue/relay`.
 */
const buildRelay = async ({
	requested,
	settings,
	trackerSettings,
	cwd,
}: {
	requested: string | true | undefined;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	cwd: string;
}) => {
	if (requested === undefined) {
		return new TerminalQuestionRelay({ settings, trackerSettings, input: process.stdin, output: process.stdout });
	}

	const directory = requested === true ? resolve(cwd, '.lightsout', 'queue', 'relay') : resolve(cwd, requested);

	await emptyRelayMailbox({ directory });
	// Printed because the default is only useful if the reader can see where it
	// landed, and a relative value resolves against `--cwd` like every other path.
	console.log(`relaying questions through ${directory}`);

	return new FileQuestionRelay({ settings, trackerSettings, directory, output: process.stdout });
};

/**
 * `lightsout queue` — drain the tracker of automatable tickets in parallel
 * worktrees, relaying any question to this terminal or to the mailbox
 * `--file-relay` names.
 *
 * Every unusable configuration is answered here rather than by the drain: they
 * are startup usage errors like every other bad flag, and the queue ships what
 * it builds, so it refuses an unshippable configuration up front rather than
 * after N tickets have been built.
 *
 * The queue needs both the `queue` block and the `ticket-tracker` block, and
 * says which one is missing. `queue` is resolved first, so a repo carrying
 * neither hears about the block the command is named for rather than about a
 * tracker it has not reached yet.
 *
 * The workers are implement work, so they resolve the config's `implement`
 * harness entry rather than needing a `queue` key of their own.
 */
export const queueCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const loaded = await readConfig({ cwd });
	const settings = resolveQueueSettings({ config: loaded, env: process.env });

	if ('error' in settings) {
		console.error(settings.error);
		return exitCli({ code: 1 });
	}

	const trackerSettings = resolveTrackerSettings({ config: loaded, env: process.env });

	if ('error' in trackerSettings) {
		console.error(trackerSettings.error);
		return exitCli({ code: 1 });
	}

	const shipSettings = resolveShipSettings({ config: loaded });

	if (shipSettings === undefined) {
		console.error(unusableTicketPatternMessage);
		return exitCli({ code: 1 });
	}

	const { config, driver, driverName } = resolveEffectiveConfigAndDriver({ config: loaded, command: 'implement' });
	const requested = flags.get('file-relay');

	if (requested !== undefined) {
		const holder = await readRunLock({ cwd });

		// Emptying the mailbox of a live drain would delete every question in
		// flight. The lock inside `runQueue` is still the real mutual exclusion;
		// this only moves the same refusal ahead of the first destructive write.
		if (holder !== undefined && isPidAlive({ pid: holder.pid })) {
			console.error(
				`another lightsout run is active in this repo: run ${holder.runId} (pid ${holder.pid}) — its relay mailbox is live, so this drain refuses rather than emptying it`,
			);

			return exitCli({ code: 1 });
		}
	}

	// Inherited by every worker session and the engine runs it launches: a
	// worker's `implement` must end on its own result rather than chain into
	// ship, whatever the worktree's config says — the drain's serial merge is
	// the only ship path in a queue run. The coordinator's own merge step calls
	// `runShip` directly and never reads this.
	process.env.LIGHTSOUT_NO_SHIP = '1';

	const relay: QuestionRelay = await buildRelay({ requested, settings, trackerSettings, cwd });
	// Closed on every exit path, so a crash never leaves the terminal holding a
	// half-written prompt.
	const report = await runQueue({
		cwd,
		settings,
		trackerSettings,
		shipSettings,
		config,
		driver,
		driverName,
		relay,
		onProgress: createProgressPrinter(),
	}).finally(() => relay.close());

	if ('error' in report) {
		console.error(report.error);
		return exitCli({ code: 1 });
	}

	printDrainReport({ report });

	// The engine's own exit discipline: 0 when everything eligible shipped, 2
	// when work remains that a re-run picks up, 1 only for a refusal.
	const resumable = report.leftBehind.length > 0 || report.outcomes.some((outcome) => !outcome.ready);

	return exitCli({ code: resumable ? pausedExitCode : 0 });
};
