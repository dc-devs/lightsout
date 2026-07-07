// An import statement, single- or multi-line: the gap before `from` cannot
// cross a semicolon or quote, so the lazy span can never swallow real code.
const importSpan = /^[ \t]*import\b(?:[^;'"]*?from\s*)?(['"])[^'"\n]+\1\s*;?/gm;

interface Params {
	text: string;
}

/**
 * Erase import statements while preserving every newline, so clone detection
 * never counts import boilerplate (non-deduplicable by construction) yet
 * still reports true line numbers for what remains.
 */
export const blankImportSpans = ({ text }: Params): string => {
	return text.replace(importSpan, (span) => span.replace(/[^\n]/g, ''));
};
