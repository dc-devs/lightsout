import type { ProseFile } from '#src/contracts/index.ts';

interface Params {
	/** The lines under the `## Prose Files` heading, or undefined when the section is absent. */
	sectionLines: string[] | undefined;
	/** The 1-based line number the section's first line sits at in the plan file. */
	firstLine: number;
}

/** The first backticked span in a bullet and everything written after it — the path it names, and where its reason would be. */
const splitAtSpan = ({ line }: { line: string }) => {
	const span = /`([^`]+)`/.exec(line);

	return span === null ? undefined : { path: span[1].trim(), rest: line.slice(span.index + span[0].length) };
};

/**
 * Read the `## Prose Files` section: one `-` bullet per file, the path in a
 * backticked span, then a dash and the reason no test states that file's
 * behaviour.
 *
 * A bullet with no backticked span is ignored rather than reported — the
 * prose-path check already reports every backticked span naming nothing, and a
 * bullet without one names nothing at all. A bullet that DOES name a path and
 * states no reason is malformed: the exemption exists because of its reason, so
 * an unreasoned one is a file that is neither covered by a test nor explained.
 */
export const parseProseFiles = ({ sectionLines, firstLine }: Params): { files: ProseFile[]; malformedLines: number[] } => {
	const files: ProseFile[] = [];
	const malformedLines: number[] = [];

	for (const [index, line] of (sectionLines ?? []).entries()) {
		if (!/^\s*-\s+/.test(line)) {
			continue;
		}

		const named = splitAtSpan({ line });

		if (named === undefined) {
			continue;
		}

		const reason = /^\s*[—–-]\s*(\S.*?)\s*$/.exec(named.rest)?.[1];

		if (named.path === '' || reason === undefined) {
			malformedLines.push(firstLine + index);

			continue;
		}

		files.push({ path: named.path, reason, line: firstLine + index });
	}

	return { files, malformedLines };
};
