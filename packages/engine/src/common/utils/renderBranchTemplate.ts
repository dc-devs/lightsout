import { toBranchSlug } from '#src/common/utils/toBranchSlug.ts';

interface Params {
	/** The repository's branch template — `{ticket}` and `{slug}` tokens. */
	template: string;
	/** The ticket reference, in whatever case the tracker or the user wrote it. Absent when no ticket names the work. */
	ticketRef?: string;
	/** The ticket's title or heading, slugged into the `{slug}` token. */
	title: string;
}

/**
 * The single characters a template may put between its tokens. Named rather
 * than written as "anything that is not a letter or a digit", so dropping a
 * token can never eat the brace of the token beside it.
 */
const separator = '[-_/.]';

/**
 * The template with the `{ticket}` token taken out, for work no ticket names.
 *
 * The token goes together with the single separator that FOLLOWS it, so a
 * template carrying a prefix still names a git namespace: `feature/` then the
 * token, a hyphen and the slug renders `feature/add-search-basics` rather than
 * the flat `feature-add-search-basics` that dropping the leading slash would
 * give. Only when the token ends the template does the separator before it drop
 * instead — which is what the trailing trim then does.
 */
const dropTicketToken = ({ template }: { template: string }) =>
	template.replaceAll(new RegExp(`\\{ticket\\}${separator}?`, 'gu'), '').replaceAll(new RegExp(`^${separator}+|${separator}+$`, 'gu'), '');

/**
 * The branch one work order gets, rendered from the repo's own template.
 *
 * An unknown token is left exactly as written, matching how ship's `pr-body`
 * template treats one. Whatever this produces must be matched by
 * `ship.ticket-pattern` — both are the repo's config, so a company branch
 * convention configures the two keys together, and that pairing is what links
 * the ticket, the worktree, the commits and the pull request.
 *
 * A repository with no ticket system at all is the normal case rather than a
 * gap, so a missing reference renders a usable branch rather than a refusal:
 * the `{ticket}` token and the separator beside it simply drop, and
 * `ship.ticket-pattern` is checked only where there is a ticket.
 */
export const renderBranchTemplate = ({ template, ticketRef, title }: Params): string => {
	const slugged = template.replaceAll('{slug}', toBranchSlug({ text: title }));

	return ticketRef === undefined ? dropTicketToken({ template: slugged }) : slugged.replaceAll('{ticket}', ticketRef.toLowerCase());
};
