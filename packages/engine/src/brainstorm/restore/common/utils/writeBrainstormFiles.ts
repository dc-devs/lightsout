import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { pathExists } from '#src/plan/index.ts';

interface Params {
	dir: string;
	files: { title: string; text: string }[];
}
export const writeBrainstormFiles = async ({ dir, files }: Params): Promise<{ restored: string[]; skipped: string[]; error?: string }> => {
	const restored: string[] = [];
	const skipped: string[] = [];

	try {
		await mkdir(dir, { recursive: true });

		for (const { title, text } of files) {
			if (await pathExists({ path: join(dir, title) })) {
				skipped.push(title);
				continue;
			}

			await writeFile(join(dir, title), text, { encoding: 'utf8', flush: true, flag: 'wx' });
			restored.push(title);
		}
	} catch (error) {
		return { restored: [], skipped: [], error: `the fetched brainstorm could not be written: ${messageOf({ error })}` };
	}

	return { restored: restored.sort(), skipped: skipped.sort() };
};
