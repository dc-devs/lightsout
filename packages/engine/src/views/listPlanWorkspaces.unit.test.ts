import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanGrade, PlanStage, RunStatus } from '#src/contracts/index.ts';
import { listPlanWorkspaces } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

/** A graded report, written as `plan grade` writes one. */
const gradeJson = ({ grade }: { grade: PlanGrade }) =>
	JSON.stringify({ planName: 'any', grade, passed: grade === PlanGrade.A, gradedAt: '2026-01-01T00:00:00.000Z' });

/** One workspace folder holding exactly the files a case names. */
const seedWorkspace = async ({ cwd, name, files, at }: { cwd: string; name: string; files: Record<string, string>; at?: string }) => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	await mkdir(dir, { recursive: true });

	for (const [path, body] of Object.entries(files)) {
		await writeFile(join(dir, path), body, 'utf8');
	}

	if (at !== undefined) {
		const when = new Date(at);

		await Promise.all(Object.keys(files).map((path) => utimes(join(dir, path), when, when)));
	}
};

/** One row, by the workspace it names. */
const rowFor = async ({ cwd, name }: { cwd: string; name: string }) => (await listPlanWorkspaces({ cwd })).find((listing) => listing.name === name);

test('a repo with no plans folder at all lists nothing rather than failing, which is what a fresh clone has', async () => {
	expect(await listPlanWorkspaces({ cwd: await freshCwd() })).toStrictEqual([]);
});

test('a workspace holding only its facts is started — the stage before anything has been written down', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'detectors', files: { 'facts.json': '{}' } });

	expect((await rowFor({ cwd, name: 'detectors' }))?.stage).toBe(PlanStage.Started);
});

test('a workspace with notes and no draft is notes only, and says it has notes', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'rough', files: { 'brainstorm-notes.md': '# rough idea' } });
	const row = await rowFor({ cwd, name: 'rough' });

	expect({ stage: row?.stage, hasNotes: row?.hasNotes, hasPlanFile: row?.hasPlanFile }).toStrictEqual({
		stage: PlanStage.NotesOnly,
		hasNotes: true,
		hasPlanFile: false,
	});
});

test('a workspace with a plan file is drafted, whether or not it also has notes', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'drafted', files: { 'brainstorm-notes.md': '# rough', 'plan.md': '# plan' } });
	const row = await rowFor({ cwd, name: 'drafted' });

	expect({ stage: row?.stage, hasPlanFile: row?.hasPlanFile, phased: row?.phased }).toStrictEqual({
		stage: PlanStage.Drafted,
		hasPlanFile: true,
		phased: false,
	});
});

test('a workspace with a grade report is graded, and carries the grade the file states', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'graded', files: { 'plan.md': '# plan', 'grade.json': gradeJson({ grade: PlanGrade.A }) } });
	const row = await rowFor({ cwd, name: 'graded' });

	expect({ stage: row?.stage, grade: row?.grade }).toStrictEqual({ stage: PlanStage.Graded, grade: PlanGrade.A });
});

test('a graded workspace with no plan file still says a draft is missing, which is what the /plan history filters on', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'graded-only', files: { 'grade.json': gradeJson({ grade: PlanGrade.BelowA }) } });
	const row = await rowFor({ cwd, name: 'graded-only' });

	// five workspaces here are graded with no plan file, which `stage` alone cannot say
	expect({ stage: row?.stage, hasPlanFile: row?.hasPlanFile }).toStrictEqual({ stage: PlanStage.Graded, hasPlanFile: false });
});

test('a workspace a passed run named is implemented, and counts that run', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'shipped', files: { 'plan.md': '# plan' } });
	await seedRunDir({ cwd, manifest: { runId: 'run-passed', plan: '.lightsout/plans/shipped/plan.md', status: RunStatus.Passed } });
	const row = await rowFor({ cwd, name: 'shipped' });

	expect({ stage: row?.stage, runCount: row?.runCount }).toStrictEqual({ stage: PlanStage.Implemented, runCount: 1 });
});

test('a workspace whose only run failed keeps the stage its files give it, so it still counts as open work', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'attempted', files: { 'plan.md': '# plan', 'grade.json': gradeJson({ grade: PlanGrade.A }) } });
	await seedRunDir({ cwd, manifest: { runId: 'run-failed', plan: '.lightsout/plans/attempted/plan.md', status: RunStatus.Failed } });
	const row = await rowFor({ cwd, name: 'attempted' });

	expect({ stage: row?.stage, runCount: row?.runCount }).toStrictEqual({ stage: PlanStage.Graded, runCount: 1 });
});

test('a phased plan says so and counts its open phases, leaving the archived ones out of that number', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'phased', files: { 'overview.md': '# overview', 'phase1-a.md': 'a', 'phase2-b.md': 'b' } });
	await mkdir(join(cwd, '.lightsout', 'plans', 'phased', 'implemented'), { recursive: true });
	await writeFile(join(cwd, '.lightsout', 'plans', 'phased', 'implemented', 'phase1-done.md'), 'done', 'utf8');
	const row = await rowFor({ cwd, name: 'phased' });

	expect({ phased: row?.phased, phaseCount: row?.phaseCount, archived: row?.implementedFiles.map((file) => file.name) }).toStrictEqual({
		phased: true,
		phaseCount: 2,
		archived: ['implemented/phase1-done.md'],
	});
});

test('a workspace whose grade report will not parse is listed without a grade rather than skipped', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'corrupt', files: { 'plan.md': '# plan', 'grade.json': '{ not json' } });
	const row = await rowFor({ cwd, name: 'corrupt' });

	// a list is an account of what is there; the file being on disk is what makes it graded
	expect({ stage: row?.stage, grade: row?.grade }).toStrictEqual({ stage: PlanStage.Graded, grade: undefined });
});

test('workspaces come back newest first, whatever order they sit in on disk', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'oldest', files: { 'plan.md': '# a' }, at: '2026-01-01T00:00:00.000Z' });
	await seedWorkspace({ cwd, name: 'newest', files: { 'plan.md': '# b' }, at: '2026-03-01T00:00:00.000Z' });
	await seedWorkspace({ cwd, name: 'middle', files: { 'plan.md': '# c' }, at: '2026-02-01T00:00:00.000Z' });

	expect((await listPlanWorkspaces({ cwd })).map((listing) => listing.name)).toStrictEqual(['newest', 'middle', 'oldest']);
});

test('a loose file beside the workspaces is not a plan, so nothing lists it', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'real', files: { 'plan.md': '# plan' } });
	await writeFile(join(cwd, '.lightsout', 'plans', 'README.md'), 'not a workspace', 'utf8');

	expect((await listPlanWorkspaces({ cwd })).map((listing) => listing.name)).toStrictEqual(['real']);
});

test('an archived phase does not lift a finished plan up the list, which is ordered by open work', async () => {
	const cwd = await freshCwd();
	const archive = join(cwd, '.lightsout', 'plans', 'finished', 'implemented');
	const when = new Date('2027-01-01T00:00:00.000Z');

	await seedWorkspace({ cwd, name: 'finished', files: { 'overview.md': '# overview' }, at: '2026-01-01T00:00:00.000Z' });
	await seedWorkspace({ cwd, name: 'active', files: { 'plan.md': '# plan' }, at: '2026-02-01T00:00:00.000Z' });
	await mkdir(archive, { recursive: true });
	await writeFile(join(archive, 'phase1-done.md'), 'done', 'utf8');
	await utimes(join(archive, 'phase1-done.md'), when, when);

	// the archived phase is the newest file on disk, and counting it would put the finished plan first
	expect((await listPlanWorkspaces({ cwd })).map((listing) => listing.name)).toStrictEqual(['active', 'finished']);
});

test('a broken link where an archived phase should be is left out, rather than taking the whole list down', async () => {
	const cwd = await freshCwd();
	const archive = join(cwd, '.lightsout', 'plans', 'linked', 'implemented');

	await seedWorkspace({ cwd, name: 'linked', files: { 'overview.md': '# overview' } });
	await mkdir(archive, { recursive: true });
	await symlink(join(archive, 'phase1-gone.target.md'), join(archive, 'phase1-gone.md'));
	const row = await rowFor({ cwd, name: 'linked' });

	expect({ archived: row?.implementedFiles, phased: row?.phased }).toStrictEqual({ archived: [], phased: true });
});
