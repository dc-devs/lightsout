import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params<Shape> {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** File within that folder, e.g. `decisions.json`. */
	fileName: string;
	/** Boundary schema the parsed JSON must satisfy. */
	schema: z.ZodType<Shape>;
	/** Error thrown when the file is missing or unreadable; receives the absolute path. */
	notFound: (filePath: string) => string;
}

/**
 * Read and validate a JSON file from the plan's own folder — the same folder
 * that holds its drafted plan text (parse-don't-cast at the boundary): a missing
 * or corrupt file is a hard error via `notFound`, never a silent empty result.
 * The shared reader behind `readDecisions`/`readPlanFacts`.
 */
export const readPlanWorkspaceFile = async <Shape>({ cwd, name, fileName, schema, notFound }: Params<Shape>): Promise<Shape> => {
	const filePath = join(planWorkspaceDir({ cwd, name }), fileName);
	const raw = await readFile(filePath, 'utf8').catch(() => {
		throw new Error(notFound(filePath));
	});

	return schema.parse(JSON.parse(raw));
};
