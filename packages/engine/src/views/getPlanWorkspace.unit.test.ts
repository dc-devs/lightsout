import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DecisionSource, PlanGrade, PlanStage, RunStatus } from '#src/contracts/index.ts';
import { getPlanWorkspace, PlanWorkspaceNotFoundError } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';

const name = 'add-search';

/** Every record a finished workspace holds, each valid against its own contract. */
const records = {
	'facts.json': JSON.stringify({
		request: 'add search',
		areas: [],
		verification: { pathsChecked: 2, missingPaths: [], scriptsChecked: 1, missingScripts: [] },
		verifiedAt: '2026-01-01T00:00:00.000Z',
	}),
	'decisions.json': JSON.stringify({
		planName: name,
		decisions: [{ source: DecisionSource.Grill, question: 'one index or two?', options: 'one / two', choice: 'one', rationale: 'simpler' }],
	}),
	'brainstorm-decisions.json': JSON.stringify({
		planName: name,
		decisions: [{ source: DecisionSource.Brainstorm, question: 'build it?', options: 'yes / no', choice: 'yes', rationale: 'users ask' }],
	}),
	'grade.json': JSON.stringify({ planName: name, grade: PlanGrade.A, passed: true, gradedAt: '2026-01-01T00:00:00.000Z' }),
	'dedup.json': JSON.stringify({ planName: name, findings: [], reviewedAt: '2026-01-01T00:00:00.000Z' }),
};

/** One workspace on disk, holding whatever a case states over the finished set. */
const seedWorkspace = async ({ files }: { files: Record<string, string> }) => {
	const cwd = await freshCwd();
	const dir = planWorkspaceFolder({ cwd: cwd, name: name });

	await mkdir(dir, { recursive: true });

	for (const [path, body] of Object.entries(files)) {
		await writeFile(join(dir, path), body, 'utf8');
	}

	return { cwd, dir };
};

test('a workspace no folder answers to is a not-found rather than an empty page', async () => {
	const cwd = await freshCwd();

	await expect(getPlanWorkspace({ cwd, name: 'never-planned' })).rejects.toThrow(PlanWorkspaceNotFoundError);
});

test('a file where a workspace folder should be is a not-found too, not a walk of something else', async () => {
	const cwd = await freshCwd();

	await mkdir(join(cwd, '.lightsout', 'work-orders', name), { recursive: true });
	await writeFile(planWorkspaceFolder({ cwd, name }), 'a file, not a folder', 'utf8');

	await expect(getPlanWorkspace({ cwd, name })).rejects.toThrow(PlanWorkspaceNotFoundError);
});

// a backslash is never the address separator, so such a name stays one segment — and one segment holding a separator is refused
test.each([{ named: '../runs' }, { named: 'nested/plan' }, { named: '..' }, { named: '' }, { named: 'lo-7-search\\001-basics' }])(
	'a name that could only address something outside the plans folder — $named — is refused before any disk is touched',
	async ({ named }) => {
		await expect(getPlanWorkspace({ cwd: await freshCwd(), name: named })).rejects.toThrow(PlanWorkspaceNotFoundError);
	},
);

test('a finished workspace hands back every record, parsed against its own contract', async () => {
	const { cwd } = await seedWorkspace({ files: { ...records, 'plan.md': '# plan' } });

	const view = await getPlanWorkspace({ cwd, name });

	expect({
		request: view.facts?.request,
		decisions: view.decisions?.decisions.length,
		brainstorm: view.brainstormDecisions?.decisions.length,
		grade: view.grade?.grade,
		dedup: view.dedup?.findings,
		problems: view.problems,
	}).toStrictEqual({ request: 'add search', decisions: 1, brainstorm: 1, grade: PlanGrade.A, dedup: [], problems: [] });
});

test('a corrupt grade report becomes a line the page can show, rather than taking the whole workspace down', async () => {
	const { cwd } = await seedWorkspace({ files: { 'plan.md': '# plan', 'grade.json': '{ not json' } });

	const view = await getPlanWorkspace({ cwd, name });

	// the pipeline's readers throw here on purpose; a viewer's job is to show the broken file
	expect({ problems: view.problems, grade: view.grade, stage: view.listing.stage }).toStrictEqual({
		problems: ['grade.json is not valid JSON'],
		grade: undefined,
		stage: PlanStage.Graded,
	});
});

test('a record that parses and does not match its contract is reported too, and leaves its field empty', async () => {
	const { cwd } = await seedWorkspace({ files: { 'plan.md': '# plan', 'facts.json': JSON.stringify({ request: 42 }) } });

	const view = await getPlanWorkspace({ cwd, name });

	expect({ facts: view.facts, reported: view.problems.length }).toStrictEqual({ facts: undefined, reported: 1 });
});

test('a workspace with nothing but transcripts still renders: no records, no problems, and the streams named', async () => {
	const { cwd } = await seedWorkspace({ files: { 'draft-stream.jsonl': '{}\n' } });

	const view = await getPlanWorkspace({ cwd, name });

	expect({ transcripts: view.transcripts.map((file) => file.name), problems: view.problems, stage: view.listing.stage }).toStrictEqual({
		transcripts: ['draft-stream.jsonl'],
		problems: [],
		stage: PlanStage.Started,
	});
});

test('a phased workspace hands back its overview and its phase files in numeric order', async () => {
	const { cwd } = await seedWorkspace({ files: { 'overview.md': '# overview', 'phase2-b.md': 'b', 'phase1-a.md': 'a' } });

	const view = await getPlanWorkspace({ cwd, name });

	expect({ plan: view.planFile?.name, phases: view.phaseFiles.map((file) => file.name), phased: view.listing.phased }).toStrictEqual({
		plan: 'overview.md',
		phases: ['phase1-a.md', 'phase2-b.md'],
		phased: true,
	});
});

test('the runs that implemented the plan come back with it, and the folder they were read from is absolute', async () => {
	const { cwd, dir } = await seedWorkspace({ files: { 'overview.md': '# overview' } });

	await seedRunDir({ cwd, manifest: { runId: 'run-one', plan: `.lightsout/work-orders/${name}/plans/phase1-a.md`, planName: name, status: RunStatus.Passed } });
	await seedRunDir({
		cwd,
		manifest: { runId: 'run-elsewhere', plan: '.lightsout/work-orders/other/plans/plan.md', planName: 'other', status: RunStatus.Passed },
	});
	const view = await getPlanWorkspace({ cwd, name });

	expect({ runs: view.runs.map((run) => run.runId), rootPath: view.rootPath, stage: view.listing.stage }).toStrictEqual({
		runs: ['run-one'],
		rootPath: dir,
		stage: PlanStage.Implemented,
	});
});

test('every record that will not parse gets its own line, and the ones that did parse still come back', async () => {
	const { cwd } = await seedWorkspace({ files: { ...records, 'grade.json': '{ not json', 'dedup.json': '{ also not json' } });

	const view = await getPlanWorkspace({ cwd, name });

	// one line per broken file, not one line for the workspace: a reader has to know which files to go and look at
	expect({ problems: view.problems, grade: view.grade, dedup: view.dedup, request: view.facts?.request }).toStrictEqual({
		problems: ['grade.json is not valid JSON', 'dedup.json is not valid JSON'],
		grade: undefined,
		dedup: undefined,
		request: 'add search',
	});
});

test('the notes a brainstorm left come back with the workspace, sized rather than read', async () => {
	const { cwd } = await seedWorkspace({ files: { 'brainstorm-notes.md': '# rough idea' } });

	const view = await getPlanWorkspace({ cwd, name });

	expect({ notes: view.notesFile?.name, bytes: view.notesFile?.bytes, hasNotes: view.listing.hasNotes, stage: view.listing.stage }).toStrictEqual({
		notes: 'brainstorm-notes.md',
		bytes: '# rough idea'.length,
		hasNotes: true,
		stage: PlanStage.NotesOnly,
	});
});

/** A ticket folder on disk, holding one plan subfolder per name given. */
const seedTicketFolder = async ({ workOrderName, planIds }: { workOrderName: string; planIds: string[] }) => {
	const cwd = await freshCwd();

	for (const planId of planIds) {
		const dir = join(cwd, '.lightsout', 'work-orders', workOrderName, 'plans', planId);

		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, 'plan.md'), `# ${planId}`, 'utf8');
	}

	return { cwd };
};

test("a plan address opens that plan's folder inside its ticket folder", async () => {
	const { cwd } = await seedTicketFolder({ workOrderName: 'lo-7-search', planIds: ['001-basics', '002-ranking'] });

	const view = await getPlanWorkspace({ cwd, name: 'lo-7-search/001-basics' });

	expect({ name: view.listing.name, plan: view.planFile?.name, rootPath: view.rootPath }).toStrictEqual({
		name: 'lo-7-search/001-basics',
		plan: 'plan.md',
		rootPath: join(cwd, '.lightsout', 'work-orders', 'lo-7-search', 'plans', '001-basics'),
	});
});

test('a name with a separator that is not a safe plan address is a not-found', async () => {
	// the last one is seeded on disk, so only the guard can refuse it
	const { cwd } = await seedTicketFolder({ workOrderName: 'lo-7-search', planIds: ['not-a-plan'] });

	await expect(getPlanWorkspace({ cwd, name: '../001-basics' })).rejects.toThrow(PlanWorkspaceNotFoundError);
	await expect(getPlanWorkspace({ cwd, name: 'a/b/001-basics' })).rejects.toThrow(PlanWorkspaceNotFoundError);
	await expect(getPlanWorkspace({ cwd, name: 'lo-7-search/not-a-plan' })).rejects.toThrow(PlanWorkspaceNotFoundError);
});

test("a plan address counts the runs of its own folder alone, and not a sibling plan's", async () => {
	const { cwd } = await seedTicketFolder({ workOrderName: 'lo-7-search', planIds: ['001-basics', '002-ranking'] });

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
			status: RunStatus.Passed,
		},
	});
	const view = await getPlanWorkspace({ cwd, name: 'lo-7-search/001-basics' });

	expect({ runs: view.runs.map((run) => run.runId), runCount: view.listing.runCount }).toStrictEqual({ runs: ['run-basics'], runCount: 1 });
});

/** One plan of a ticket on disk, in the ticket folder's plans folder. */
const seedTicketPlan = async ({ workOrderName, planId }: { workOrderName: string; planId: string }) => {
	const cwd = await freshCwd();
	const dir = join(cwd, '.lightsout', 'work-orders', workOrderName, 'plans', planId);

	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'plan.md'), '# plan', 'utf8');
	await writeFile(join(dir, 'phase1-a.md'), 'a', 'utf8');

	return { cwd };
};

test("getPlanWorkspace: the workspace root and its file paths sit inside the ticket's plans folder", async () => {
	const { cwd } = await seedTicketPlan({ workOrderName: 'lo-7-search', planId: '001-basics' });

	const view = await getPlanWorkspace({ cwd, name: 'lo-7-search/001-basics' });

	expect({ rootPath: view.rootPath, plan: view.planFile?.path, phases: view.phaseFiles.map((file) => file.path) }).toStrictEqual({
		rootPath: join(cwd, '.lightsout', 'work-orders', 'lo-7-search', 'plans', '001-basics'),
		plan: '.lightsout/work-orders/lo-7-search/plans/001-basics/plan.md',
		phases: ['.lightsout/work-orders/lo-7-search/plans/001-basics/phase1-a.md'],
	});
});
