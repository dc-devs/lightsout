import type { StandardsFinding } from '@/contracts';

interface Params {
	/** Repo-relative path every site sits in — a finding's identity is the path alone. */
	file: string;
	/** Line spans within that file, in report order. */
	spans: Array<{ startLine: number; endLine: number }>;
}

/**
 * A finding's `files` entries for several sites in one file.
 *
 * The site key dedupes on path, so the extra entries carry each location
 * without splitting one file's violations into separate findings to accept or
 * resolve.
 */
export const buildLineSites = ({ file, spans }: Params): StandardsFinding['files'] =>
	spans.map(({ startLine, endLine }) => ({ path: file, startLine, endLine }));
