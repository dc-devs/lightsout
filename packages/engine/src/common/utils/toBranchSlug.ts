interface Params {
	/** A title, a heading or a file stem — whatever the caller has that names the work. */
	text: string;
}

/**
 * A title as a branch-safe word: lowercase, single dashes, no leading or
 * trailing dash, at most 40 characters cut on a dash.
 *
 * Shared rather than owned by either caller: the queue renders a ticket's
 * branch and a standalone implementation run renders its own, and two sluggers
 * would let the branch a ticket gets from the queue drift from the branch the
 * same ticket gets from `implement`.
 *
 * Nothing branch-safe in the text answers an empty string rather than a dash on
 * its own; the caller decides what an empty slug means.
 */
export const toBranchSlug = ({ text }: Params): string => {
	const maxSlugLength = 40;
	const dashed = text
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');

	let slug = dashed;

	if (dashed.length > maxSlugLength) {
		const cut = dashed.slice(0, maxSlugLength);
		const lastDash = cut.lastIndexOf('-');

		slug = lastDash === -1 ? cut : cut.slice(0, lastDash);
	}

	// The trailing-dash strip is on the single exit path, so a cut made on a
	// dash cannot leave one behind whichever branch produced the slug.
	return slug.replaceAll(/-+$/g, '');
};
