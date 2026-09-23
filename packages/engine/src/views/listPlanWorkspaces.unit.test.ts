import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { PlanGrade, PlanStage, RunStatus } from '#src/contracts/index.ts';
import { getPlanWorkspace, listPlanWorkspaces } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A graded report, written as `plan grade` writes one. */
const gradeJson = ({ grade }: { grade: PlanGrade }) =>
	JSON.stringify({ planName: 'any', grade, passed: grade === PlanGrade.A, gradedAt: '2026-01-01T00:00:00.000Z' });

/** One workspace folder holding exactly the files a case names. */
const seedWorkspace = async ({ cwd, name, files, at }: { cwd: string; name: string; files: Record<string, string>; at?: string }) => {
	const dir = planWorkspaceFolder({ cwd: cwd, name: name });

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
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-passed', plan: '.lightsout/work-orders/shipped/plans/plan.md', planName: 'shipped', status: RunStatus.Passed },
	});
	const row = await rowFor({ cwd, name: 'shipped' });

	expect({ stage: row?.stage, runCount: row?.runCount }).toStrictEqual({ stage: PlanStage.Implemented, runCount: 1 });
});

test('a workspace whose only run failed keeps the stage its files give it, so it still counts as open work', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'attempted', files: { 'plan.md': '# plan', 'grade.json': gradeJson({ grade: PlanGrade.A }) } });
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-failed', plan: '.lightsout/work-orders/attempted/plans/plan.md', planName: 'attempted', status: RunStatus.Failed },
	});
	const row = await rowFor({ cwd, name: 'attempted' });

	expect({ stage: row?.stage, runCount: row?.runCount }).toStrictEqual({ stage: PlanStage.Graded, runCount: 1 });
});

test('a phased plan says so and counts its open phases, leaving the archived ones out of that number', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'phased', files: { 'overview.md': '# overview', 'phase1-a.md': 'a', 'phase2-b.md': 'b' } });
	await mkdir(join(cwd, '.lightsout', 'work-orders', 'phased', 'plans', 'implemented'), { recursive: true });
	await writeFile(join(cwd, '.lightsout', 'work-orders', 'phased', 'plans', 'implemented', 'phase1-done.md'), 'done', 'utf8');
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
	await writeFile(join(cwd, '.lightsout', 'work-orders', 'README.md'), 'not a workspace', 'utf8');

	expect((await listPlanWorkspaces({ cwd })).map((listing) => listing.name)).toStrictEqual(['real']);
});

test('an archived phase does not lift a finished plan up the list, which is ordered by open work', async () => {
	const cwd = await freshCwd();
	const archive = join(cwd, '.lightsout', 'work-orders', 'finished', 'plans', 'implemented');
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
	const archive = join(cwd, '.lightsout', 'work-orders', 'linked', 'plans', 'implemented');

	await seedWorkspace({ cwd, name: 'linked', files: { 'overview.md': '# overview' } });
	await mkdir(archive, { recursive: true });
	await symlink(join(archive, 'phase1-gone.target.md'), join(archive, 'phase1-gone.md'));
	const row = await rowFor({ cwd, name: 'linked' });

	expect({ archived: row?.implementedFiles, phased: row?.phased }).toStrictEqual({ archived: [], phased: true });
});

test('a ticket folder lists one row per plan under its plan address, and no row of its own', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'lo-7-search/001-basics', files: { 'plan.md': '# basics' }, at: '2026-03-01T00:00:00.000Z' });
	await seedWorkspace({ cwd, name: 'lo-7-search/002-ranking', files: { 'plan.md': '# ranking' }, at: '2026-02-01T00:00:00.000Z' });
	await seedWorkspace({ cwd, name: 'lo-3-old', files: { 'plan.md': '# legacy' }, at: '2026-01-01T00:00:00.000Z' });

	const listings = await listPlanWorkspaces({ cwd });

	// the ticket folder itself is not a plan, so a row named lo-7-search would be a fourth entry here
	expect(listings.map((listing) => listing.name)).toStrictEqual(['lo-7-search/001-basics', 'lo-7-search/002-ranking', 'lo-3-old']);
});

test("a ticket folder's own files and a subfolder that is no plan contribute no row of their own", async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'lo-7-search', files: { 'state.json': '{}' } });
	await seedWorkspace({ cwd, name: 'lo-7-search/001-basics', files: { 'plan.md': '# basics' } });
	await seedWorkspace({ cwd, name: 'lo-7-search/scratch', files: { 'notes.md': '# scratch' } });

	const listings = await listPlanWorkspaces({ cwd });

	// the ticket record is the folder's own file and `scratch` is no plan id, so the one plan is the one row
	expect(listings.map((listing) => listing.name)).toStrictEqual(['lo-7-search/001-basics']);
});

test('each plan of a ticket folder counts only the runs its own folder named', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'lo-7-search/001-basics', files: { 'plan.md': '# basics' } });
	await seedWorkspace({ cwd, name: 'lo-7-search/002-ranking', files: { 'plan.md': '# ranking' } });
	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-basics',
			plan: '.lightsout/work-orders/lo-7-search/plans/001-basics/plan.md',
			planName: 'lo-7-search/001-basics',
			status: RunStatus.Passed,
		},
	});
	await seedRunDir({
		cwd,
		manifest: {
			runId: 'run-ranking',
			plan: '.lightsout/work-orders/lo-7-search/plans/002-ranking/plan.md',
			planName: 'lo-7-search/002-ranking',
			status: RunStatus.Failed,
		},
	});

	const listings = await listPlanWorkspaces({ cwd });

	expect(Object.fromEntries(listings.map((listing) => [listing.name, listing.runCount]))).toStrictEqual({
		'lo-7-search/001-basics': 1,
		'lo-7-search/002-ranking': 1,
	});
});

test('a workspace does not count the runs of a sibling whose folder name starts with its own', async () => {
	const cwd = await freshCwd();

	await seedWorkspace({ cwd, name: 'lo-7', files: { 'plan.md': '# seven' } });
	await seedWorkspace({ cwd, name: 'lo-70', files: { 'plan.md': '# seventy' } });
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-seventy', plan: '.lightsout/work-orders/lo-70/plans/plan.md', planName: 'lo-70', status: RunStatus.Passed },
	});

	const listings = await listPlanWorkspaces({ cwd });

	// the run names the plan it belongs to, so a name lo-7 is a prefix of is still somebody else's
	expect(Object.fromEntries(listings.map((listing) => [listing.name, listing.runCount]))).toStrictEqual({ 'lo-7': 0, 'lo-70': 1 });
});

/**
 * A primary checkout holding the plans a case names, with a linked worktree cut
 * from it — the shape the views are asked from once a session moves into a tree.
 */
const setupWorktreeView = async ({ plans = { 'lo-150-observability': { 'plan.md': '# plan' } } }: { plans?: Record<string, Record<string, string>> } = {}) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-150-observability');

	for (const [name, files] of Object.entries(plans)) {
		await seedWorkspace({ cwd, name, files });
	}

	execSync(`git worktree add -q -b lo-150-observability "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

test("the plan views list and open the primary checkout's plans from inside a linked worktree", async () => {
	const { primary, worktree } = await setupWorktreeView();

	const listings = await listPlanWorkspaces({ cwd: worktree });
	const view = await getPlanWorkspace({ cwd: worktree, name: 'lo-150-observability' });

	// the worktree holds no plans folder at all, so a view rooted on it would report a repo with no plans
	expect({ listed: listings.map((listing) => listing.name), plan: view.planFile?.name, rootPath: realpathSync(view.rootPath) }).toStrictEqual({
		listed: ['lo-150-observability'],
		plan: 'plan.md',
		rootPath: realpathSync(join(primary, '.lightsout', 'work-orders', 'lo-150-observability', 'plans')),
	});
});

test('a ticket folder read from a linked worktree still lists one row per plan address', async () => {
	const { worktree } = await setupWorktreeView({
		plans: { 'lo-7-search/001-basics': { 'plan.md': '# basics' }, 'lo-7-search/002-ranking': { 'plan.md': '# ranking' } },
	});

	const listings = await listPlanWorkspaces({ cwd: worktree });

	// the plans inside a ticket folder are read from the primary too, or the folder reads as empty and lists one row of its own name
	expect(listings.map((listing) => listing.name).sort()).toStrictEqual(['lo-7-search/001-basics', 'lo-7-search/002-ranking']);
});

/** One folder under the tickets directory, holding exactly the files a case names. */
const seedTicketFolder = async ({ cwd, path, files }: { cwd: string; path: string; files: Record<string, string> }) => {
	const dir = join(cwd, '.lightsout', 'work-orders', ...path.split('/'));

	await mkdir(dir, { recursive: true });

	for (const [name, body] of Object.entries(files)) {
		await writeFile(join(dir, name), body, 'utf8');
	}
};

test('listPlanWorkspaces: a ticket holding plan folders contributes one row per plan address', async () => {
	const cwd = await freshCwd();

	await seedTicketFolder({ cwd, path: 'lo-7-search/plans/001-basics', files: { 'plan.md': '# basics' } });
	await seedTicketFolder({ cwd, path: 'lo-7-search/plans/002-ranking', files: { 'plan.md': '# ranking' } });

	const listings = await listPlanWorkspaces({ cwd });

	// the ticket folder is where a ticket's plans live rather than a plan itself, so a row named lo-7-search would be a third entry
	expect(listings.map((listing) => listing.name).sort()).toStrictEqual(['lo-7-search/001-basics', 'lo-7-search/002-ranking']);
});

test('listPlanWorkspaces: a loose-file ticket is one row, and neither its records nor a runs sibling becomes one', async () => {
	const cwd = await freshCwd();

	await seedTicketFolder({ cwd, path: 'lo-9-notes', files: { 'state.json': '{}', 'state-sync.json': '{}' } });
	await seedTicketFolder({ cwd, path: 'lo-9-notes/plans', files: { 'brainstorm-notes.md': '# rough', 'facts.json': '{}' } });
	await seedTicketFolder({ cwd, path: 'lo-9-notes/runs/run-loose', files: { 'manifest.json': '{}' } });

	const listings = await listPlanWorkspaces({ cwd });

	// the record files sit above the plans folder and the runs folder beside it, so a row named runs or plans would mean one of them was read as a plan
	expect(listings.map((listing) => listing.name)).toStrictEqual(['lo-9-notes']);
});

test('listPlanWorkspaces: a ticket folder holding no plans folder contributes no row', async () => {
	const cwd = await freshCwd();

	await seedTicketFolder({ cwd, path: 'lo-9-notes/plans/001-basics', files: { 'plan.md': '# basics' } });
	await seedTicketFolder({ cwd, path: 'main', files: { 'ship.json': '{}', 'branch-state.json': '{}' } });

	const listings = await listPlanWorkspaces({ cwd });

	// every branch gets a folder for its ship record, so a branch that never carried a plan must not appear as one
	expect(listings.map((listing) => listing.name)).toStrictEqual(['lo-9-notes/001-basics']);
});
