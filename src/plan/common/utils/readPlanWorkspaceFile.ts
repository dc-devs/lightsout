import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { planWorkspaceDir } from '@/plan/planWorkspaceDir';

interface Params<Shape> {
	cwd: string;
	/** Kebab plan name — the workspace key. */
	name: string;
	/** File within the workspace, e.g. `decisions.json`. */
	fileName: string;
	/** Boundary schema the parsed JSON must satisfy. */
	schema: z.ZodType<Shape>;
	/** Error thrown when the file is missing or unreadable; receives the absolute path. */
	notFound: (filePath: string) => string;
}

/**
 * Read and validate a plan workspace's JSON file (parse-don't-cast at the
 * boundary): a missing or corrupt file is a hard error via `notFound`, never a
 * silent empty result. The shared reader behind `readDecisions`/`readPlanFacts`.
 */
export const readPlanWorkspaceFile = async <Shape>({ cwd, name, fileName, schema, notFound }: Params<Shape>): Promise<Shape> => {
	const filePath = join(planWorkspaceDir({ cwd, name }), fileName);
	const raw = await readFile(filePath, 'utf8').catch(() => {
		throw new Error(notFound(filePath));
	});

	return schema.parse(JSON.parse(raw));
};
