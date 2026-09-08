import { isAbsolute, join } from 'node:path';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';

interface Params {
	/** Repo root — a relative citation is resolved against it. */
	cwd: string;
	/** The path span of a citation: everything before the first `:`, so `file.ts:symbol` names the file and never the symbol. */
	token: string;
}

/**
 * Whether a cited path names a file that is really there.
 *
 * Two callers ask this — the judge whose `already-answered` dismissal cites a
 * file, and the re-verification judge whose closing citation does — and they
 * must resolve a relative citation the same way, or the same evidence would be
 * believed on one path through the grade and refused on the other.
 */
export const citedPathExists = async ({ cwd, token }: Params): Promise<boolean> => pathExists({ path: isAbsolute(token) ? token : join(cwd, token) });
