import { yellow } from '#src/cli/common/terminal/yellow.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { readPlanTicketRef } from '#src/plan/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the plan folder's own name. */
	name: string;
	/** Where the line goes — stdout by default, so a test reads what was printed. */
	write?: (line: string) => void;
}

/**
 * Say once, in yellow, that a plan folder is not named after its ticket.
 *
 * A plan folder carries its branch's name, which is what ties the plan to the
 * ticket, the worktree, the commits and the pull request. A folder that carries
 * no ticket id is used exactly as before — this changes no exit code, returns
 * nothing a caller can branch on, and never throws, so "still drafts, grades
 * and implements from its folder path" holds by construction rather than by
 * test. A repo with no `queue.tracker` chose no ticket convention and hears
 * nothing at all.
 */
export const printPlanTicketWarning = async ({ cwd, name, write = console.log }: Params): Promise<void> => {
	// A config the engine cannot parse is not this advisory's problem: the
	// commands that need one already refuse by name. Deliberately swallowed,
	// against readOptionalConfig's own rule, because an advisory must never
	// change what a run does.
	const config = await readOptionalConfig({ cwd }).catch(() => undefined);

	if (config?.queue?.tracker === undefined) {
		return;
	}

	const settings = resolveShipSettings({ config });

	// An unusable `ship.ticket-pattern` is already refused by name where it
	// matters; blaming a folder for it here would name the wrong thing.
	if (settings === undefined) {
		return;
	}

	if (readPlanTicketRef({ name, ticketPattern: settings.ticketPattern }) !== undefined) {
		return;
	}

	write(
		`${yellow('⚠')} plan folder '${name}' carries no ticket id — name a plan folder after its ticket's branch, matching this repo's ship.ticket-pattern. Continuing from the folder path.`,
	);
};
