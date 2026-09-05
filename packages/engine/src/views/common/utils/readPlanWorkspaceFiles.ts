import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { planWorkspaceDir, planWorkspacePath } from '#src/plan/index.ts';
import type { PlanWorkspaceFiles } from '#src/views/common/types/PlanWorkspaceFiles.ts';

/** The one subfolder the walk descends into: where a phased plan's finished phases are archived. */
const archiveFolder = 'implemented';

/** A drafted phase file, and the number that orders it. */
const phasePattern = /^phase(\d+)-.+\.md$/;

/** One entry, stat'd — absent when it disappeared between the folder listing and the stat, which a viewer treats as never having been there. */
const statEntry = async ({ dir, name, workspacePath }: { dir: string; name: string; workspacePath: string }) => {
	const stats = await stat(join(dir, name)).catch(() => undefined);

	return stats === undefined ? undefined : { name, path: `${workspacePath}/${name}`, bytes: stats.size, updatedAt: stats.mtime.toISOString() };
};

/** The archived phase files, workspace-relative — read one level deep and no further. */
const readArchive = async ({ dir, workspacePath }: { dir: string; workspacePath: string }) => {
	const names: string[] = await readdir(join(dir, archiveFolder)).catch(() => []);
	const archived = await Promise.all(
		names.filter((name) => phasePattern.test(name)).map((name) => statEntry({ dir, name: `${archiveFolder}/${name}`, workspacePath })),
	);

	return archived.filter((file) => file !== undefined);
};

interface Params {
	cwd: string;
	name: string;
}

/**
 * Every file in a plan workspace, stat'd and bucketed by role. Nothing is
 * parsed.
 *
 * The near-namesake `readPlanWorkspaceFile` reads and validates one named file
 * strictly, for the pipeline. This one opens nothing: it is what a list page
 * needs to draw a row without paying for the workspace's contents.
 *
 * The walk reads the top level plus exactly one known subfolder. A directory
 * named `implemented/` is read one level deep into `implementedFiles`, counted
 * in neither `phaseFiles` nor `updatedAt` — an archived phase must not make a
 * finished plan look active. Every other directory is skipped entirely.
 */
export const readPlanWorkspaceFiles = async ({ cwd, name }: Params): Promise<PlanWorkspaceFiles> => {
	const dir = planWorkspaceDir({ cwd, name });
	const workspacePath = planWorkspacePath({ name });
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const folderStats = await stat(dir).catch(() => undefined);
	const stated = await Promise.all(entries.filter((entry) => entry.isFile()).map((entry) => statEntry({ dir, name: entry.name, workspacePath })));
	const present = stated.filter((file) => file !== undefined);
	const named = new Map(present.map((file) => [file.name, file]));
	const phaseFiles = present
		.flatMap((file) => {
			const numbered = phasePattern.exec(file.name);

			return numbered === null ? [] : [{ file, order: Number(numbered[1]) }];
		})
		.sort((first, second) => first.order - second.order)
		.map((entry) => entry.file);
	const planFile = named.get('overview.md') ?? named.get('plan.md');
	const notesFile = named.get('brainstorm-notes.md');
	const transcripts = present.filter((file) => file.name.endsWith('-stream.jsonl'));
	const claimed = new Set([planFile, notesFile, ...phaseFiles, ...transcripts].map((file) => file?.name));
	const updatedAts = present.map((file) => file.updatedAt).sort();

	return {
		planFile,
		phaseFiles,
		notesFile,
		transcripts,
		implementedFiles: entries.some((entry) => entry.isDirectory() && entry.name === archiveFolder) ? await readArchive({ dir, workspacePath }) : [],
		others: new Map(present.filter((file) => !claimed.has(file.name)).map((file) => [file.name, file])),
		// A workspace holding no files falls back to the folder's own mtime, and a
		// folder that vanished between the caller's check and this walk to the
		// epoch — an absence sorts last rather than crashing the list it is in.
		updatedAt: updatedAts[updatedAts.length - 1] ?? folderStats?.mtime.toISOString() ?? new Date(0).toISOString(),
	};
};
