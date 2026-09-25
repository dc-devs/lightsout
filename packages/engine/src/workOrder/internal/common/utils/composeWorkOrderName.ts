import { toBranchSlug } from '#src/common/utils/toBranchSlug.ts';

interface Params {
	/** The ticket this work belongs to, when one was named. Absent for a work order named from words alone. */
	ticketRef?: string;
	/** The words that name the work — summarised from a ticket's title, or typed by the caller. */
	words: string;
}

/**
 * The label a work order's folder takes, or the one sentence saying why the
 * words cannot make one.
 *
 * The one home of a label's shape: the reference and the words, joined by a
 * single hyphen, or the words alone when no ticket names the work — so a
 * tracker-free label never opens with a hyphen. Both halves go through
 * `toBranchSlug`, which is what makes "a label is always one path segment"
 * true by construction rather than by every caller remembering: the engine only
 * ever writes a label, so a branch template carrying a prefix can never reach a
 * folder path.
 */
export const composeWorkOrderName = ({ ticketRef, words }: Params): { name: string } | { error: string } => {
	const slugged = toBranchSlug({ text: words });

	if (slugged === '') {
		return { error: `'${words}' holds nothing a work order can be named after: a label is lowercase letter-and-digit words joined by single hyphens` };
	}

	const reference = ticketRef === undefined ? '' : toBranchSlug({ text: ticketRef });

	return { name: [reference, slugged].filter((segment) => segment !== '').join('-') };
};
