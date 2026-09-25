import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { ReadGenerationFile } from '#src/plan/restore/internal/common/types/ReadGenerationFile.ts';

interface Params {
	/** The plan folder this generation becomes, which must not exist yet. */
	dir: string;
	files: ReadGenerationFile[];
}

/** Write the complete restored set off to the side, then expose it with one rename. */
export const writeRestoredGeneration = async ({ dir, files }: Params): Promise<{ error: string } | undefined> => {
	let temporaryDir: string | undefined;

	try {
		const parent = dirname(dir);

		await mkdir(parent, { recursive: true });
		temporaryDir = await mkdtemp(join(parent, '.restore-'));

		// The set is small, and sequential writes guarantee no sibling write is
		// still touching the temporary directory if one fails and cleanup begins.
		for (const { title, text } of files) {
			await writeFile(join(temporaryDir, title), text, 'utf8');
		}

		await rename(temporaryDir, dir);

		return undefined;
	} catch (error) {
		if (temporaryDir !== undefined) {
			// Cleanup is best-effort and must never hide the primary setup/write error.
			await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
		}

		return { error: `the restored plan could not be written: ${messageOf({ error })}` };
	}
};
