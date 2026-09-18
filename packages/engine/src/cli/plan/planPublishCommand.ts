import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { bold } from '#src/cli/common/terminal/bold.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { createProgressPrinter } from '#src/cli/common/utils/createProgressPrinter.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { PlanningStep, RunStatus } from '#src/contracts/index.ts';
import { publishPlan, recordPlanCommandRun, recordPlanningStep } from '#src/plan/index.ts';
import { publishTicketPlan } from '#src/ticket/index.ts';

/** What the two publishers have in common, so one printing sequence serves both. */
interface PlanPublishOutcome {
	ticketRef?: string;
	published: string[];
	stale: string[];
	error?: string;
	/** Set by the ticket publisher when the plan's files landed but `ticket.json` does not say so. */
	recordError?: string;
}

/**
 * `lightsout plan publish` at the terminal.
 *
 * It spawns no agent, so it resolves no driver — the shape
 * `planVerifyFactsCommand` already sets. The config is read with `readConfig`
 * rather than the optional reader: publishing needs a `ticket-tracker` block, so
 * a repo with no config has nothing to resolve and is refused by name, the way
 * `queueCommand` treats the same requirement.
 *
 * A plan named by its address publishes through the ticket record, which also
 * puts its brainstorm generation and `ticket.json` on the ticket; a legacy
 * folder publishes exactly as it always has, under bare titles and with no
 * record touched.
 *
 * A stale attachment does not change the exit code. The manifest committed
 * last selects the new generation, so an unlisted attachment publish
 * deliberately left behind is harmless and remains visible for manual cleanup.
 * A record that could not be written is different: the plan's files landed but
 * nothing on the ticket says which generation they are, so the step is failed
 * and the sentence goes to stderr after the list of what did land.
 */
export const planPublishCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const config = await readConfig({ cwd });
	const address = parsePlanAddress({ name });
	// One reading for both records, so a publish that failed cannot read as
	// passed in one of them.
	const statusOf = ({ result }: { result: PlanPublishOutcome }) =>
		result.error === undefined && result.recordError === undefined ? RunStatus.Passed : RunStatus.Failed;
	// Wrapped after the required flag and the config read, so a command that
	// refuses before doing any work opens no level. Publishing spawns no agent,
	// so this command run carries no child either.
	const report = await recordPlanCommandRun({
		cwd,
		name,
		label: 'plan publish',
		statusOf,
		work: () =>
			recordPlanningStep({
				cwd,
				name,
				step: PlanningStep.Publish,
				work: (): Promise<PlanPublishOutcome> =>
					address === undefined
						? publishPlan({ cwd, name, config, env: process.env, onProgress: createProgressPrinter() })
						: publishTicketPlan({ cwd, address: name, config, env: process.env, onProgress: createProgressPrinter() }),
				statusOf,
			}),
	});

	if (report.error !== undefined) {
		console.error(`\n${report.error}`);
		return exitCli({ code: 1 });
	}

	console.log(`\n${bold(`plan publish ${name}`)} — ${report.published.length} file(s) attached to ${report.ticketRef}`);

	for (const file of report.published) {
		console.log(`  ${file}`);
	}

	if (report.stale.length > 0) {
		console.log(`\nstill on ${report.ticketRef} from an earlier publish, and not written by this run: ${report.stale.join(', ')} — publish deleted nothing.`);
	}

	if (report.recordError !== undefined) {
		console.error(`\n${report.recordError}`);
		return exitCli({ code: 1 });
	}

	return exitCli({ code: 0 });
};
