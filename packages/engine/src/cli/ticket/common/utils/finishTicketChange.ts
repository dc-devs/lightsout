import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import type { TicketRecordChange } from '#src/ticket/index.ts';

interface Params<Change extends TicketRecordChange> {
	/** The ticket the change was made to, named in the retry a failed publish is answered with. */
	ticketBranch: string;
	outcome: Change | { error: string };
	/** The command's own lines, printed after the change's notice. */
	describe: (change: Change) => string[];
}

/**
 * The one place a `lightsout ticket` subcommand's outcome becomes output and an
 * exit code.
 *
 * Three endings, and the middle one is the reason this exists: a change that
 * reached disk but not the tracker has HAPPENED, so its lines are printed and
 * the address a skill reads is still there, while the exit code and stderr say
 * the ticket does not know about it yet. The notice comes before the command's
 * own lines, because a caller reads the last line as the answer.
 */
export const finishTicketChange = async <Change extends TicketRecordChange>({ ticketBranch, outcome, describe }: Params<Change>): Promise<never> => {
	if ('error' in outcome) {
		console.error(outcome.error);

		return exitCli({ code: 1 });
	}

	const change: Change = outcome;

	if (change.notice !== undefined) {
		console.log(change.notice);
	}

	for (const line of describe(change)) {
		console.log(line);
	}

	if (change.publishError !== undefined) {
		console.error(
			`${change.publishError}\nthe change is on this machine but not on the ticket — send it with \`lightsout ticket sync --name ${ticketBranch}\``,
		);

		return exitCli({ code: 1 });
	}

	return exitCli({ code: 0 });
};
