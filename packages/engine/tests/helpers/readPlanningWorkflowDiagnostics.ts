import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Read the local diagnostic transport without granting it canonical authority. */
export const readPlanningWorkflowDiagnostics = async ({ root }: { root: string }): Promise<string[]> => {
	const entries = await readdir(root, { withFileTypes: true });
	const texts: string[] = [];
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) texts.push(...(await readPlanningWorkflowDiagnostics({ root: path })));
		else if (entry.isFile()) texts.push(await readFile(path, 'utf8'));
	}
	return texts;
};
