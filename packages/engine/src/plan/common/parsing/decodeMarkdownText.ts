interface Params {
	text: string;
	lossless?: boolean;
}

const entities: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	...Object.fromEntries(
		[9, 10, 11, 12, 13, 32, 92, 96, 124, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279].map(
			(code) => [`&#${code};`, String.fromCodePoint(code)],
		),
	),
};

/** Decode the engine's explicit escapes once; literal entity text and unknown entities remain literal. */
export const decodeMarkdownText = ({ text, lossless = true }: Params): string =>
	text.replace(lossless ? /&(?:amp|lt|gt|#\d+);/g : /&(?:amp|lt|gt|#92|#124|#96|#13|#10|#32);/g, (entity) => entities[entity] ?? entity);
