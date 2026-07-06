import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FrictionRecord } from '@lightsout/contracts';

interface Params {
	cwd: string;
}

/**
 * Read the accumulated friction log. Validated line-by-line at the boundary;
 * malformed lines are skipped, never guessed at.
 */
export const readFriction = async ({ cwd }: Params) => {
	const raw = await readFile(join(cwd, '.lightsout', 'friction.jsonl'), 'utf8').catch(() => '');

	return raw
		.split('\n')
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const parsed = FrictionRecord.safeParse(JSON.parse(line));

				return parsed.success ? [parsed.data] : [];
			} catch {
				return [];
			}
		});
};
