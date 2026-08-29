import { pausedExitCode } from '#src/cli/common/constants/pausedExitCode.ts';
import { unusableTicketPatternMessage } from '#src/cli/common/constants/unusableTicketPatternMessage.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { resolveEffectiveConfigAndDriver } from '#src/cli/common/utils/resolveEffectiveConfigAndDriver.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { QuestionRelay, type QueueDrainReport, resolveQueueSettings, runQueue } from '#src/queue/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';

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
 * `lightsout queue` — drain the tracker of automatable tickets in parallel
 * worktrees, relaying any question to this terminal.
 *
 * Both unusable configurations are answered here rather than by the drain:
 * they are startup usage errors like every other bad flag, and the queue ships
 * what it builds, so it refuses an unshippable configuration up front rather
 * than after N tickets have been built.
 *
 * The workers are implement work, so they resolve the config's `implement`
 * harness entry rather than needing a `queue` key of their own.
 */
export const queueCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const loaded = await readConfig({ cwd });
	const settings = resolveQueueSettings({ config: loaded, env: process.env });

	if ('error' in settings) {
		console.error(settings.error);
		return exitCli({ code: 1 });
	}

	const shipSettings = resolveShipSettings({ config: loaded });

	if (shipSettings === undefined) {
		console.error(unusableTicketPatternMessage);
		return exitCli({ code: 1 });
	}

	const { config, driver, driverName } = resolveEffectiveConfigAndDriver({ config: loaded, command: 'implement' });
	const relay = new QuestionRelay({ settings, input: process.stdin, output: process.stdout });
	// Closed on every exit path, so a crash never leaves the terminal holding a
	// half-written prompt.
	const report = await runQueue({
		cwd,
		settings,
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
