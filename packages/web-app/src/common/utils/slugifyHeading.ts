interface Params {
	/** A heading's text — either the flattened children of a rendered heading, or the raw markdown line minus its hashes. */
	text: string;
}

/**
 * The anchor id a markdown heading gets.
 *
 * One algorithm for both sides of a table of contents: `Markdown` puts this id
 * on the heading it renders, and `DocToc` links to it from the raw line, so the
 * two agree by construction rather than by inspection. Inline markdown is
 * stripped first — a heading reads the same whether or not it spells a word in
 * backticks.
 */
export const slugifyHeading = ({ text }: Params): string =>
	text
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[`*_~[\]]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
