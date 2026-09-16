interface Params {
	text: string;
}

/** Encode exact text without changing pipe, newline, backtick or entity content on a parser round trip. */
export const encodeMarkdownTableCell = ({ text }: Params): string =>
	text
		.replaceAll('&', '&amp;')
		.replaceAll('\\', '&#92;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('|', '&#124;')
		.replaceAll('`', '&#96;')
		.replace(/[\t-\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/g, (character) => `&#${character.charCodeAt(0)};`)
		.replace(/^ +| +$/g, (spaces) => '&#32;'.repeat(spaces.length));
