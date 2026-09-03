import { resolve } from 'node:path';
import { pausedExitCode } from '#src/cli/common/constants/pausedExitCode.ts';
import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
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

/**
 * Everything the drain needs from the config, or the one sentence naming the
 * part of it that is unusable.
 *
 * The `queue` block is resolved first, so a repo carrying neither block hears
 * about the one the command is named for rather than about a tracker it has not
 * reached yet. All three are resolved here rather than by the drain: they are
 * startup usage errors like any other bad flag, and the queue ships what it
 * builds, so an unshippable configuration is refused up front rather than after
 * N tickets have been built.
 */
const resolveQueueStartup = ({ config, env }: { config: LightsoutConfig; env: NodeJS.ProcessEnv }) => {
	const settings = resolveQueueSettings({ config, env });

	if ('error' in settings) {
		return { error: settings.error };
	}

	const trackerSettings = resolveTrackerSettings({ config, env });

	if ('error' in trackerSettings) {
		return { error: trackerSettings.error };
	}

	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return { error: unusableTicketPatternMessage };
	}

	return { settings, trackerSettings, shipSettings };
};

/** One line per ticket the drain touched, and one per ticket it deliberately did not — a ticket must never vanish from the summary. */
const printDrainReport = ({ report }: { report: QueueDrainReport }) => {
	for (const outcome of report.outcomes) {
		if (outcome.ready) {
			console.log(`${outcome.ticket.identifier} ${outcome.branch} shipped`);

			if (outcome.reconciliationFailure !== undefined) {
				console.log(`  ${outcome.reconciliationFailure}`);
			}
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
 * The workers are implement work, so they resolve the config's `implement`
 * harness entry rather than needing a `queue` key of their own.
 */
export const queueCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const loaded = await readConfig({ cwd });
	const startup = resolveQueueStartup({ config: loaded, env: process.env });

	if ('error' in startup) {
		console.error(startup.error);
		return exitCli({ code: 1 });
	}

	const { settings, trackerSettings, shipSettings } = startup;
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
		env: process.env,
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
	// A reconciled already-merged ticket carries `settled`: it is reported, but a
	// re-run has nothing to pick up for it, so it never makes the drain exit 2.
	// A reconciliation failure does not either — the branch is merged and will
	// not be offered again; only the tracker is stale, and the line above says so.
	const resumable = report.leftBehind.some((entry) => entry.settled !== true) || report.outcomes.some((outcome) => !outcome.ready);

	return exitCli({ code: resumable ? pausedExitCode : 0 });
};
