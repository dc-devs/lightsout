import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import type { WorkOrderStateChange } from '#src/workOrder/index.ts';

interface Params<Change extends WorkOrderStateChange> {
	/** The work order the change was made to, named in the retry a failed publish is answered with. */
	name: string;
	outcome: Change | { error: string };
	/** The command's own lines, printed after the change's notice. */
	describe: (change: Change) => string[];
}

/**
 * The one place a `lightsout work-order` subcommand's outcome becomes output and an
 * exit code.
 *
 * Three endings, and the middle one is the reason this exists: a change that
 * reached disk but not the tracker has HAPPENED, so its lines are printed and
 * the address a skill reads is still there, while the exit code and stderr say
 * the ticket does not know about it yet. The notice comes before the command's
 * own lines, because a caller reads the last line as the answer.
 */
export const finishWorkOrderChange = async <Change extends WorkOrderStateChange>({ name, outcome, describe }: Params<Change>): Promise<never> => {
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
		console.error(`${change.publishError}\nthe change is on this machine but not on the ticket — send it with \`lightsout work-order sync --name ${name}\``);

		return exitCli({ code: 1 });
	}

	return exitCli({ code: 0 });
};
