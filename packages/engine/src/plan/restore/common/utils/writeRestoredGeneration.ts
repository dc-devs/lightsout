import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { ReadGenerationFile } from '#src/plan/restore/common/types/ReadGenerationFile.ts';
import { flushPlanningDirectory, installPlanningGeneration, writePlanningBlob } from '#src/plan/workflow/index.ts';

interface Params {
	/** The plan folder this generation becomes, which must not exist yet. */
	dir: string;
	files: ReadGenerationFile[];
	beforeExpose?: (params: { directory: string }) => Promise<void>;
	planning?: { name: string; record: string; marker: string };
}

/** Write the complete restored set off to the side, then expose it with one rename. */
export const writeRestoredGeneration = async ({ dir, files, planning, beforeExpose }: Params): Promise<{ error: string } | undefined> => {
	let temporaryDir: string | undefined;

	try {
		const parent = dirname(dir);

		await mkdir(parent, { recursive: true });
		temporaryDir = await mkdtemp(join(parent, '.restore-'));

		// The set is small, and sequential writes guarantee no sibling write is
		// still touching the temporary directory if one fails and cleanup begins.
		for (const { title, text } of files) {
			await writePlanningBlob({ path: join(temporaryDir, title), text });
		}
		if (planning)
			await installPlanningGeneration({
				directory: temporaryDir,
				name: planning.name,
				text: planning.record,
				expectedDigest: sha256({ content: planning.record }),
				marker: planning.marker,
			});
		await beforeExpose?.({ directory: temporaryDir });
		await flushPlanningDirectory({ path: temporaryDir });

		await rename(temporaryDir, dir);
		await flushPlanningDirectory({ path: parent });

		return undefined;
	} catch (error) {
		if (temporaryDir !== undefined) {
			// Cleanup is best-effort and must never hide the primary setup/write error.
			await rm(temporaryDir, { recursive: true, force: true }).catch(() => undefined);
		}

		return { error: `the restored plan could not be written: ${messageOf({ error })}` };
	}
};
