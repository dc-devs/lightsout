interface Params {
	/** A ticket body, a plan body — whatever markdown the caller has that opens on a title. */
	text: string;
}

/**
 * The text's first line with its heading markers taken off.
 *
 * Shared rather than owned by either caller: a direct run turns this into the
 * branch's slug and into the commit's subject, and two readers would let the
 * branch and the commit it carries stop naming the same work.
 */
export const headingOf = ({ text }: Params): string =>
	text
		.split('\n')[0]
		.replace(/^#+\s*/, '')
		.trim();
