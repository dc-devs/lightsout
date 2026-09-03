import { readFile } from 'node:fs/promises';
import type { z } from 'zod';

interface Params<Shape> {
	path: string;
	/** Boundary schema the parsed JSON must satisfy. */
	schema: z.ZodType<Shape>;
}

/**
 * Read a JSON file the engine wrote with `writeJsonFile` and validate it, or
 * answer undefined when the file is missing, unreadable, not JSON, or does not
 * satisfy the contract.
 *
 * The counterpart to `writeJsonFile` for records another run reads back:
 * undefined is the one answer for every way the file can fail, so a caller
 * never has to tell a crash mid-write apart from a file an older version wrote.
 * Use `readPlanWorkspaceFile` instead where a corrupt file must be a hard error.
 */
export const readJsonFile = async <Shape>({ path, schema }: Params<Shape>): Promise<Shape | undefined> => {
	const raw = await readFile(path, 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return undefined;
	}

	try {
		const parsed = schema.safeParse(JSON.parse(raw));

		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};
