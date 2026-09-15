interface Params {
	line: string;
}

/** Read Markdown table cells, including escaped delimiters and lossless engine-encoded text. */
export const parseMarkdownTableCells = ({ line }: Params): string[] => {
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
	const entities: Record<string, string> = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&#92;': '\\',
		'&#124;': '|',
		'&#96;': '`',
		'&#13;': '\r',
		'&#10;': '\n',
		'&#32;': ' ',
	};
	return cells.map((value) => value.trim().replace(/&(?:amp|lt|gt|#92|#124|#96|#13|#10|#32);/g, (entity) => entities[entity]));
};
