import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { PlanningPath } from '#src/contracts/index.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { flushPlanningDirectory } from '#src/plan/workflow/store/common/utils/flushPlanningDirectory.ts';
import { planningErrorCode } from '#src/plan/workflow/store/common/utils/planningErrorCode.ts';

interface Params {
	cwd: string;
	name: string;
	create?: boolean;
}

const ensureDirectory = async ({ path, create }: { path: string; create: boolean }) => {
	if (create) {
		try {
			await mkdir(path);
		} catch (error) {
			if (!(planningErrorCode({ error }) === 'EEXIST')) throw error;
		}
	}
	try {
		const status = await lstat(path);
		if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Planning storage directory cannot be a symlink: ${path}`);
		if (create) await flushPlanningDirectory({ path: dirname(path) });
	} catch (error) {
		if (!(planningErrorCode({ error }) === 'ENOENT') || create) throw error;
	}
};

/** Validate each address component, persist new directory entries, and refuse redirected canonical storage. */
export const planningStorePaths = async ({
	cwd,
	name,
	create = false,
}: Params): Promise<{ root: string; commits: string; blobs: string; staging: string; local: string }> => {
	PlanningPath.parse(name);
	if (name === '.') throw new Error('A planning address must name a workspace');
	const repository = await realpath(cwd);
	const root = join(planWorkspaceDir({ cwd: repository, name }), '.planning');
	let ancestor = repository;
	for (const segment of relative(repository, root).split('/')) {
		ancestor = join(ancestor, segment);
		await ensureDirectory({ path: ancestor, create });
	}
	const paths = { root, commits: join(root, 'commits'), blobs: join(root, 'blobs'), staging: join(root, 'staging'), local: join(root, 'local') };
	for (const path of [paths.commits, paths.blobs, paths.staging, paths.local]) await ensureDirectory({ path, create });
	return paths;
};
