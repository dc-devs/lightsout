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
		.replaceAll('\r', '&#13;')
		.replaceAll('\n', '&#10;')
		.replace(/^ +| +$/g, (spaces) => '&#32;'.repeat(spaces.length));
