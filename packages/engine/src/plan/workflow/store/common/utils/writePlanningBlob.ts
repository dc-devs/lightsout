import { randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';
import { readPlanningFile } from '#src/plan/workflow/store/common/utils/readPlanningFile.ts';

interface Params {
	path: string;
	text: string;
}

/** A complete flushed temporary file becomes visible atomically; interrupted writes never poison a content address. */
export const writePlanningBlob = async ({ path, text }: Params): Promise<void> => {
	try {
		const existing = await readPlanningFile({ path });
		if (!existing.equals(Buffer.from(text, 'utf8'))) throw new Error(`Corrupt immutable planning blob: ${path}`);
		return;
	} catch (error) {
		if (!(planningErrorCode({ error }) === 'ENOENT')) throw error;
	}
	const temporary = `${path}.${randomUUID()}.partial`;
	const handle = await open(temporary, 'wx');
	try {
		await handle.writeFile(text, 'utf8');
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(temporary, path);
	} catch (error) {
		if (!(planningErrorCode({ error }) === 'EEXIST')) throw error;
		const existing = await readPlanningFile({ path });
		if (!existing.equals(Buffer.from(text, 'utf8'))) throw new Error(`Corrupt immutable planning blob: ${path}`);
	} finally {
		await unlink(temporary);
	}
};
