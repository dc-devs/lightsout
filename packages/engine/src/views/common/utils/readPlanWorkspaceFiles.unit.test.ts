import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readPlanWorkspaceFiles } from '#src/views/common/utils/readPlanWorkspaceFiles.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

const name = 'add-search';

/** A workspace folder holding exactly the files a case names, each with a body long enough to have a size. */
const seedWorkspace = async ({ files = {}, folders = [] }: { files?: Record<string, string>; folders?: string[] } = {}) => {
	const cwd = await freshCwd();
	const dir = join(cwd, '.lightsout', 'plans', name);

	await mkdir(dir, { recursive: true });

	for (const folder of folders) {
		await mkdir(join(dir, folder), { recursive: true });
	}

	for (const [path, body] of Object.entries(files)) {
		await writeFile(join(dir, path), body, 'utf8');
	}

	return { cwd, dir };
};

/** A file's mtime, stated rather than left to the clock, so an ordering assertion cannot depend on how fast the disk was. */
const touch = ({ dir, path, at }: { dir: string; path: string; at: string }) => {
	const when = new Date(at);

	return utimes(join(dir, path), when, when);
};

test('a phased workspace leads with its overview and orders the phase files by number, not by name', async () => {
	const { cwd } = await seedWorkspace({
		files: { 'overview.md': '# overview', 'phase10-last.md': 'ten', 'phase2-second.md': 'two', 'phase1-first.md': 'one' },
	});

	const files = await readPlanWorkspaceFiles({ cwd, name });

	// sorted by the captured number: a string sort would put phase10 second
	expect({ plan: files.planFile?.name, phases: files.phaseFiles.map((file) => file.name) }).toStrictEqual({
		plan: 'overview.md',
		phases: ['phase1-first.md', 'phase2-second.md', 'phase10-last.md'],
	});
});

test('a single plan is plan.md, and it carries no phases', async () => {
	const { cwd } = await seedWorkspace({ files: { 'plan.md': '# plan' } });

	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect({ plan: files.planFile?.name, phases: files.phaseFiles }).toStrictEqual({ plan: 'plan.md', phases: [] });
});

test('a workspace holding both prefers the overview, and the single plan beside it is just another file', async () => {
	const { cwd } = await seedWorkspace({ files: { 'overview.md': '# overview', 'plan.md': '# plan' } });

	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect({ plan: files.planFile?.name, others: [...files.others.keys()] }).toStrictEqual({ plan: 'overview.md', others: ['plan.md'] });
});

test('a file is stat’d rather than opened: its size and mtime are what comes back, with a path getPlanDocument can take', async () => {
	const { cwd, dir } = await seedWorkspace({ files: { 'notes.md': 'rough idea' } });

	await touch({ dir, path: 'notes.md', at: '2026-03-04T05:06:07.000Z' });
	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect(files.notesFile).toStrictEqual({
		name: 'notes.md',
		path: '.lightsout/plans/add-search/notes.md',
		bytes: 'rough idea'.length,
		updatedAt: '2026-03-04T05:06:07.000Z',
	});
});

test('the agent transcripts are named and sized, and nothing else lands in that bucket', async () => {
	const { cwd } = await seedWorkspace({ files: { 'draft-stream.jsonl': '{}', 'grade-stream.jsonl': '{}', 'dedup.json': '{}' } });

	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect(files.transcripts.map((file) => file.name).sort()).toStrictEqual(['draft-stream.jsonl', 'grade-stream.jsonl']);
});

test('every other top-level file is keyed by its name, which is how a caller asks whether a workspace has one', async () => {
	const { cwd } = await seedWorkspace({ files: { 'facts.json': '{}', 'grade.json': '{}', 'grade-wiring-rejected-1.txt': 'nope' } });

	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect([...files.others.keys()].sort()).toStrictEqual(['facts.json', 'grade-wiring-rejected-1.txt', 'grade.json']);
});

test('an archived phase file comes back workspace-relative, and stays out of the phase files', async () => {
	const { cwd } = await seedWorkspace({
		files: { 'overview.md': '# overview', 'phase1-open.md': 'open', 'implemented/phase1-design-system.md': 'done', 'implemented/README.md': 'why' },
		folders: ['implemented'],
	});

	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect({ archived: files.implementedFiles.map((file) => file.name), phases: files.phaseFiles.map((file) => file.name) }).toStrictEqual({
		archived: ['implemented/phase1-design-system.md'],
		phases: ['phase1-open.md'],
	});
});

test('an archived phase does not make a finished plan look active: only the top level moves updatedAt', async () => {
	const { cwd, dir } = await seedWorkspace({
		files: { 'overview.md': '# overview', 'implemented/phase1-design-system.md': 'done' },
		folders: ['implemented'],
	});

	await touch({ dir, path: 'overview.md', at: '2026-01-01T00:00:00.000Z' });
	await touch({ dir, path: 'implemented/phase1-design-system.md', at: '2026-09-09T00:00:00.000Z' });
	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect(files.updatedAt).toBe('2026-01-01T00:00:00.000Z');
});

test('any other directory is skipped whole, rather than walked or stat’d as a file', async () => {
	const { cwd } = await seedWorkspace({ files: { 'plan.md': '# plan', 'nested/phase1-buried.md': 'buried' }, folders: ['nested'] });

	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect({ archived: files.implementedFiles, others: [...files.others.keys()] }).toStrictEqual({ archived: [], others: [] });
});

test('updatedAt is the newest file in the workspace, whatever order the folder lists them in', async () => {
	const { cwd, dir } = await seedWorkspace({ files: { 'facts.json': '{}', 'plan.md': '# plan' } });

	await touch({ dir, path: 'facts.json', at: '2026-05-05T00:00:00.000Z' });
	await touch({ dir, path: 'plan.md', at: '2026-02-02T00:00:00.000Z' });
	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect(files.updatedAt).toBe('2026-05-05T00:00:00.000Z');
});

test('a workspace holding no files at all falls back to the folder’s own mtime rather than reading as undated', async () => {
	const { cwd, dir } = await seedWorkspace();
	const when = new Date('2026-07-07T00:00:00.000Z');

	await utimes(dir, when, when);
	const files = await readPlanWorkspaceFiles({ cwd, name });

	expect(files.updatedAt).toBe('2026-07-07T00:00:00.000Z');
});

test('a folder that is not there comes back empty and undated rather than throwing, so one deleted workspace cannot take a list down', async () => {
	const cwd = await freshCwd();

	const files = await readPlanWorkspaceFiles({ cwd, name: 'never-existed' });

	expect({ plan: files.planFile, phases: files.phaseFiles, updatedAt: files.updatedAt }).toStrictEqual({
		plan: undefined,
		phases: [],
		updatedAt: new Date(0).toISOString(),
	});
});
