import { link, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { validateBrainstormGeneration } from '#src/plan/workflow/brainstorm/validateBrainstormGeneration.ts';
import { validateBrainstormRestoreBinding } from '#src/plan/workflow/brainstorm/validateBrainstormRestoreBinding.ts';
import { flushPlanningDirectory, installPlanningGeneration, readPlanningFile, writePlanningBlob } from '#src/plan/workflow/store/index.ts';

interface Params {
	cwd: string;
	name: string;
	files: ReadonlyMap<string, string>;
	generation: string;
	marker: string;
	directory?: string;
}

/** Install all verified authority atomically; existing unrelated local inputs are preserved and conflicting projections cannot be mixed. */
export const restoreBrainstormGeneration = async ({
	cwd,
	name,
	files,
	generation,
	marker,
	directory,
}: Params): Promise<{ restored: string[]; skipped: string[] }> => {
	validateBrainstormGeneration({ files, generation, name });
	const target = directory ?? planWorkspaceDir({ cwd, name });
	const restored: string[] = [];
	const skipped: string[] = [];
	let existing = false;
	try {
		const info = await lstat(target);
		if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Brainstorm restore requires a real directory');
		existing = true;
	} catch (error) {
		if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
	}
	for (const [path, text] of files) {
		try {
			if (!(await readPlanningFile({ path: join(target, path) })).equals(Buffer.from(text)))
				throw new Error(`Existing ${path} conflicts with the selected brainstorm generation`);
			skipped.push(path);
		} catch (error) {
			if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
		}
	}
	const core = files.get('brainstorm-record.json');
	if (!core) throw new Error('The verified brainstorm core disappeared');
	const current = await validateBrainstormRestoreBinding({ cwd, name, directory, core, generation });
	await mkdir(dirname(target), { recursive: true });
	const staging = await mkdtemp(join(dirname(target), '.brainstorm-restore-'));
	try {
		for (const [path, text] of files) await writePlanningBlob({ path: join(staging, path), text });
		if (!current) await installPlanningGeneration({ directory: staging, name, text: core, expectedDigest: sha256({ content: core }), marker });
		if (!existing) {
			await rename(staging, target);
			restored.push(...files.keys());
		} else {
			if (!current) {
				await rename(join(staging, '.planning'), join(target, '.planning'));
				await flushPlanningDirectory({ path: target });
			}
			for (const path of files.keys())
				if (!skipped.includes(path)) {
					await link(join(staging, path), join(target, path));
					restored.push(path);
				}
		}
		await flushPlanningDirectory({ path: target });
		await flushPlanningDirectory({ path: dirname(target) });
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
	return { restored: restored.sort(), skipped: skipped.sort() };
};
