import { isPathToken } from '#src/plan/common/paths/isPathToken.ts';

interface Params {
	line: string;
}

/**
 * The first two backtick-delimited path tokens in a line, in order — the source
 * and destination of a `### ` + "`old/path.ts` → `new/path.ts`" move heading.
 * Returns undefined unless both are present, so a malformed heading is reported
 * by the caller rather than silently parsed as a one-path move.
 */
export const pathPairFromLine = ({ line }: Params): { from: string; to: string } | undefined => {
	const paths: string[] = [];

	for (const match of line.matchAll(/`([^`]+)`/g)) {
		const token = match[1].trim().split(/\s+/)[0];

		if (isPathToken({ token })) {
			paths.push(token);
		}

		if (paths.length === 2) {
			break;
		}
	}

	return paths.length === 2 ? { from: paths[0], to: paths[1] } : undefined;
};
