interface Params {
	body: string;
	heading: string;
	line: string;
}

const readHeadingLevel = ({ line }: { line: string }) => {
	const hashes = /^(#{1,6})\s/.exec(line)?.[1];

	return hashes === undefined ? undefined : hashes.length;
};

export const addLineUnderHeading = ({ body, heading, line }: Params): string => {
	const lines = body.split('\n');
	let result: string;

	if (lines.includes(line)) {
		result = body;
	} else {
		const headingIndex = lines.findIndex((candidate) => candidate.trim() === heading.trim());

		if (headingIndex === -1) {
			result = `${body.trimEnd()}\n\n${heading}\n\n${line}`.trimStart();
		} else {
			const level = readHeadingLevel({ line: heading.trim() }) ?? 2;
			const after = lines.slice(headingIndex + 1);
			const nextHeading = after.findIndex((candidate) => (readHeadingLevel({ line: candidate }) ?? 7) <= level);
			const sectionEnd = nextHeading === -1 ? lines.length : headingIndex + 1 + nextHeading;
			let insertAt = sectionEnd;

			while (insertAt > headingIndex + 1 && lines[insertAt - 1]?.trim() === '') {
				insertAt -= 1;
			}

			result = [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)].join('\n');
		}
	}

	return result;
};
