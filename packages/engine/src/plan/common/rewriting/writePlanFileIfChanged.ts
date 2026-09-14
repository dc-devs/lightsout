import { writeFile } from 'node:fs/promises';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';

interface Params {
	/** Absolute path of the plan file. */
	path: string;
	/** The file's contents as they were read. */
	original: string;
	/** The rewritten lines, joined and compared against `original`. */
	lines: string[];
}

/**
 * Write one plan file back only when the rewrite differs from what was read, and
 * report which of the two happened.
 *
 * Every section sync runs once a repair round and again after every recorded
 * decision, so each has to be safe to repeat — a rewrite with identical content
 * would move the file's modification time and make every consumer look at it
 * again for nothing.
 */
export const writePlanFileIfChanged = async ({ path, original, lines }: Params): Promise<SyncedPlanFile> => {
	const rewritten = lines.join('\n');
	const updated = rewritten !== original;

	if (updated) {
		await writeFile(path, rewritten, 'utf8');
	}

	return { path, updated };
};
