import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { PlanningPath } from '#src/contracts/index.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';

interface Params {
	workspace: string;
	path: string;
	content: string;
}

/** Projection replacement is atomic per file and cannot follow a redirected parent into canonical storage. */
export const writePlanningView = async ({ workspace, path, content }: Params): Promise<void> => {
	PlanningPath.parse(path);
	if (path === '.' || path === '.planning' || path.startsWith('.planning/')) throw new Error('A view cannot overwrite planning storage');
	let parent = workspace;
	const target = join(workspace, path);
	for (const segment of relative(workspace, dirname(target)).split('/').filter(Boolean)) {
		parent = join(parent, segment);
		try {
			await mkdir(parent);
		} catch (error) {
			if (!(planningErrorCode({ error }) === 'EEXIST')) throw error;
		}
		const status = await lstat(parent);
		if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('A planning view parent cannot be redirected');
	}
	const temporary = join(dirname(target), `.planning-view-${randomUUID()}`);
	try {
		await writeFile(temporary, content, { flag: 'wx' });
		await rename(temporary, target);
	} finally {
		await rm(temporary, { force: true });
	}
};
