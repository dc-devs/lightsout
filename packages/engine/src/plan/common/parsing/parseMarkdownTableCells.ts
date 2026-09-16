import { decodeMarkdownText } from '#src/plan/common/parsing/decodeMarkdownText.ts';

interface Params {
	line: string;
	decode?: boolean;
}

/** Read Markdown table cells, including escaped delimiters and lossless engine-encoded text. */
export const parseMarkdownTableCells = ({ line, decode = true }: Params): string[] => {
	const cells: string[] = [];
	let cell = '';
	const text = line.trim();
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '\\' && (text[index + 1] === '|' || text[index + 1] === '\\')) {
			cell += text[index + 1];
			index += 1;
		} else if (char === '|') {
			cells.push(cell);
			cell = '';
		} else cell += char;
	}
	cells.push(cell);
	if (text.startsWith('|')) cells.shift();
	if (text.endsWith('|') && cells.at(-1) === '') cells.pop();
	return cells.map((value) => (decode ? decodeMarkdownText({ text: value.trim(), lossless: false }) : value.trim()));
};
