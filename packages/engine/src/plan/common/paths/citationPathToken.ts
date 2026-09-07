import { isPathToken } from '#src/plan/common/paths/isPathToken.ts';

interface Params {
	/** A judge's `answerAt` — either a path, optionally with a `:symbol` suffix, or a quoted plan line. */
	citation: string;
}

/**
 * The file a citation names, or `undefined` when the citation is not a path at
 * all. Only the span before the first `:` is considered, so `file.ts:symbol`
 * names the file and never the symbol.
 *
 * The single spelling of "is this citation a path", for the same reason
 * `citedPathExists` is the single spelling of "is that file there": the judge
 * join and the re-verification check both split a citation this way, and a
 * citation one reads as a path while the other reads it as a quote would be
 * believed on one route through the grade and refused on the other.
 */
export const citationPathToken = ({ citation }: Params): string | undefined => {
	const token = citation.split(':')[0] ?? '';

	return isPathToken({ token }) ? token : undefined;
};
