import { toBranchSlug } from '#src/common/utils/toBranchSlug.ts';

interface Params {
	/** The repository's branch template — `{ticket}` and `{slug}` tokens. */
	template: string;
	/** The ticket reference, in whatever case the tracker or the user wrote it. */
	ticketRef: string;
	/** The ticket's title or heading, slugged into the `{slug}` token. */
	title: string;
}

/**
 * The branch one ticket gets, rendered from the repo's own template.
 *
 * An unknown token is left exactly as written, matching how ship's `pr-body`
 * template treats one. Whatever this produces must be matched by
 * `ship.ticket-pattern` — both are the repo's config, so a company branch
 * convention configures the two keys together, and that pairing is what links
 * the ticket, the worktree, the commits and the pull request.
 *
 * Shared rather than owned by either caller: the queue renders a ticket's branch
 * on a drain and a standalone implementation run renders one for the same
 * ticket, and two renderers would let the two branches drift apart.
 */
export const renderBranchTemplate = ({ template, ticketRef, title }: Params): string =>
	template.replaceAll('{ticket}', ticketRef.toLowerCase()).replaceAll('{slug}', toBranchSlug({ text: title }));
