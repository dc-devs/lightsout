import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { DecisionSource, PlanGrade, PlanStage, RunStatus } from '#src/contracts/index.ts';
import { getPlanWorkspace, PlanWorkspaceNotFoundError } from '#src/views/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
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
	const dir = join(cwd, '.lightsout', 'plans', name);

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

	await mkdir(join(cwd, '.lightsout', 'plans'), { recursive: true });
	await writeFile(join(cwd, '.lightsout', 'plans', name), 'a file, not a folder', 'utf8');

	await expect(getPlanWorkspace({ cwd, name })).rejects.toThrow(PlanWorkspaceNotFoundError);
});

test.each([{ named: '../runs' }, { named: 'nested/plan' }, { named: '..' }, { named: '' }])(
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

	await seedRunDir({ cwd, manifest: { runId: 'run-one', plan: `.lightsout/plans/${name}/phase1-a.md`, status: RunStatus.Passed } });
	await seedRunDir({ cwd, manifest: { runId: 'run-elsewhere', plan: '.lightsout/plans/other/plan.md', status: RunStatus.Passed } });
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
