import { readFile } from 'node:fs/promises';
import type { z } from 'zod';

interface Params<Shape> {
	path: string;
	schema: z.ZodType<Shape>;
}

/**
 * Read a JSONL file into validated records. Each non-empty line is JSON-parsed
 * and schema-checked at the boundary; malformed or rejected lines are skipped,
 * never guessed at. A missing file reads as empty.
 */
export const readJsonlRecords = async <Shape>({ path, schema }: Params<Shape>): Promise<Shape[]> => {
	const raw = await readFile(path, 'utf8').catch(() => '');

	return raw
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const parsed = schema.safeParse(JSON.parse(line));

				return parsed.success ? [parsed.data] : [];
			} catch {
				return [];
			}
		});
};
