import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';

interface Params {
	ticket: TicketSummary;
	/** `QueueSettings.branchTemplate` — `{ticket}` and `{slug}` tokens. */
	template: string;
}

/** The title as a branch-safe word: lowercase, single dashes, no leading or trailing dash, at most 40 characters cut on a dash. */
const toSlug = ({ title }: { title: string }) => {
	const maxSlugLength = 40;
	const dashed = title
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');

	if (dashed.length <= maxSlugLength) {
		return dashed;
	}

	const cut = dashed.slice(0, maxSlugLength);
	const lastDash = cut.lastIndexOf('-');

	return (lastDash === -1 ? cut : cut.slice(0, lastDash)).replaceAll(/-+$/g, '');
};

/**
 * The branch one ticket gets, rendered from the repo's own template.
 *
 * An unknown token is left exactly as written, matching how ship's `pr-body`
 * template treats one. Whatever this produces must be matched by
 * `ship.ticket-pattern` — both are the repo's config, so a company branch
 * convention configures the two keys together, and that pairing is what links
 * the ticket, the worktree, the commits and the pull request.
 *
 * Linear's own `issue.branchName` is deliberately not used: it carries a
 * per-user prefix that `ship.ticket-pattern` would not match.
 */
export const toTicketBranch = ({ ticket, template }: Params): string =>
	template.replaceAll('{ticket}', ticket.identifier.toLowerCase()).replaceAll('{slug}', toSlug({ title: ticket.title }));
