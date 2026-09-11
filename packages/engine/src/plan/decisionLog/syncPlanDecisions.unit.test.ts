import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, type DecisionsRecord } from '#src/contracts/index.ts';
import { syncPlanDecisions } from '#src/plan/decisionLog/index.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';
import { writePlanDeliverable } from '#tests/helpers/writePlanDeliverable.ts';

// The runner owns the whole deliverable: `plan.md` and `overview.md` carry the
// rendered table, every phase file carries the pointer at the overview, and a
// deliverable that cannot resolve — no plan, no overview, no record — is
// refused before the first byte is written.

/** A plan file carrying a hand-written Decision Log the engine is about to take over, plus the heading that follows it. */
const planBody = ({ title }: { title: string }) => `# ${title}

## Context

Why this plan exists.

## Decision Log

Whatever the writer typed here before the engine owned the section.

## Global Constraints

- None

## Verification

- \`true\` — types clean
`;

/** One decision row; only the fields a test varies are parameters. */
const decisionRow = ({
	question,
	choice,
	source = DecisionSource.Elicitation,
}: {
	question: string;
	choice: string;
	source?: DecisionSource;
}): DecisionRow => ({ source, question, options: 'this / that', choice, rationale: 'because it is the cheaper of the two', assumption: false });

const twoRows = [
	decisionRow({ question: 'Where does the log live?', choice: 'In the overview' }),
	decisionRow({ question: 'Who writes it?', choice: 'The engine, never a writer', source: DecisionSource.Grill }),
];

/** The `## Decision Log` section's body — its heading through the line before the next `##` heading. */
const decisionLogSection = ({ text }: { text: string }) => {
	const lines = text.split('\n');
	const start = lines.findIndex((line) => line.startsWith('## Decision Log'));

	if (start === -1) {
		return '';
	}

	const rest = lines.slice(start + 1);
	const next = rest.findIndex((line) => line.startsWith('## '));

	return (next === -1 ? rest : rest.slice(0, next)).join('\n');
};

/** The section's numbered table body rows — the header and separator rows have no integer first cell. */
const tableRows = ({ section }: { section: string }) => section.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));

/** Each reported file keyed by its basename, so an assertion pins what happened rather than the walk's order. */
const updatedByFile = ({ files }: { files: { path: string; updated: boolean }[] }) =>
	Object.fromEntries(files.map((file) => [basename(file.path), file.updated]));

/** Write the plan's own `decisions.json` — the record the runner reads when it is handed none. */
const seedDecisions = ({ dir, name, rows }: { dir: string; name: string; rows: DecisionRow[] }) => {
	writeFileSync(join(dir, 'decisions.json'), JSON.stringify({ planName: name, decisions: rows }));
};

/** A single-file plan deliverable, with the decision record on disk unless the case is about its absence. */
const setupSinglePlan = ({ record = true }: { record?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'decision-log';
	const dir = writePlanDeliverable({ cwd, name, body: planBody({ title: 'Decision Log' }) });
	const planPath = join(dir, 'plan.md');

	if (record) {
		seedDecisions({ dir, name, rows: twoRows });
	} else {
		// the deliverable helper seeds an empty record beside every plan it writes,
		// and this case is about the record not being there at all
		rmSync(join(dir, 'decisions.json'));
	}

	return { cwd, name, readPlan: () => readFileSync(planPath, 'utf8') };
};

/** A phased deliverable of two phase files, with the overview beside them unless the case is about its absence. */
const setupPhasedPlan = ({ overview = true }: { overview?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'phased-log';
	const phases = {
		'phase1-core.md': planBody({ title: 'Phase 1 — Core' }),
		'phase2-wire.md': planBody({ title: 'Phase 2 — Wire' }),
	};
	const files = overview ? { 'overview.md': planBody({ title: 'Overview' }), ...phases } : phases;
	const dir = writePhasedPlanDeliverable({ cwd, name, files });

	seedDecisions({ dir, name, rows: twoRows });

	return { cwd, name, path: (base: string) => join(dir, base), readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};

/** The workspace a phased draft holds between its overview spawn and its first phase file: `overview.md` alone, which resolves to no plan at all. */
const setupOverviewOnly = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'mid-draft';
	const dir = writePhasedPlanDeliverable({ cwd, name, files: { 'overview.md': planBody({ title: 'Overview' }) } });

	seedDecisions({ dir, name, rows: twoRows });

	return { cwd, name, overviewPath: join(dir, 'overview.md'), readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};

/** A phased deliverable whose record holds one row declaring the phase it concerns and one row declaring none. */
const setupDeclaringPhasedPlan = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'declared-phases';
	const bases = ['overview.md', 'phase1-core.md', 'phase2-extra.md'];
	const dir = writePhasedPlanDeliverable({
		cwd,
		name,
		files: {
			'overview.md': planBody({ title: 'Overview' }),
			'phase1-core.md': planBody({ title: 'Phase 1 — Core' }),
			'phase2-extra.md': planBody({ title: 'Phase 2 — Extra' }),
		},
	});
	const rows: DecisionRow[] = [
		{ ...decisionRow({ question: 'Which phase carries the extra wiring?', choice: 'The second phase' }), phases: ['phase2-extra.md'] },
		decisionRow({ question: 'Who writes the log?', choice: 'The engine, never a writer' }),
	];

	seedDecisions({ dir, name, rows });

	return { cwd, name, bases, readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};

describe('syncPlanDecisions', () => {
	test('syncPlanDecisions: writes the full table into a single plan and reports it updated', async () => {
		const plan = setupSinglePlan();

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: plan.name });

		expectStatus(result, 'complete');
		const section = decisionLogSection({ text: plan.readPlan() });
		// one table row per record, the choices written through, and no pointer at
		// an overview a single plan does not have
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: tableRows({ section }).length,
			firstChoice: section.includes('In the overview'),
			secondChoice: section.includes('The engine, never a writer'),
			pointsElsewhere: section.includes('overview.md'),
		}).toStrictEqual({ reported: { 'plan.md': true }, rows: 2, firstChoice: true, secondChoice: true, pointsElsewhere: false });
	});

	test('syncPlanDecisions: gives the overview the table and every phase file the reference', async () => {
		const phased = setupPhasedPlan();

		const result = await syncPlanDecisions({ cwd: phased.cwd, name: phased.name });

		expectStatus(result, 'complete');
		const overview = decisionLogSection({ text: phased.readFile('overview.md') });
		const first = decisionLogSection({ text: phased.readFile('phase1-core.md') });
		const second = decisionLogSection({ text: phased.readFile('phase2-wire.md') });

		// the table has exactly one home, and each phase points at it
		expect({
			reported: updatedByFile({ files: result.files }),
			overviewRows: tableRows({ section: overview }).length,
			firstRows: tableRows({ section: first }).length,
			secondRows: tableRows({ section: second }).length,
			firstPoints: first.includes('overview.md'),
			secondPoints: second.includes('overview.md'),
		}).toStrictEqual({
			reported: { 'overview.md': true, 'phase1-core.md': true, 'phase2-wire.md': true },
			overviewRows: 2,
			firstRows: 0,
			secondRows: 0,
			firstPoints: true,
			secondPoints: true,
		});
	});

	test('syncPlanDecisions: reports every file unchanged on a repeated run', async () => {
		const phased = setupPhasedPlan();
		const first = await syncPlanDecisions({ cwd: phased.cwd, name: phased.name });

		expectStatus(first, 'complete');
		const afterFirst = ['overview.md', 'phase1-core.md', 'phase2-wire.md'].map((base) => phased.readFile(base));

		const second = await syncPlanDecisions({ cwd: phased.cwd, name: phased.name });

		expectStatus(second, 'complete');
		// nothing is reported updated, and every byte is the byte the first run left
		expect({
			reported: updatedByFile({ files: second.files }),
			texts: ['overview.md', 'phase1-core.md', 'phase2-wire.md'].map((base) => phased.readFile(base)),
		}).toStrictEqual({
			reported: { 'overview.md': false, 'phase1-core.md': false, 'phase2-wire.md': false },
			texts: afterFirst,
		});
	});

	test("syncPlanDecisions: puts a declaring row's affects marker in the overview and a repeated sync writes nothing", async () => {
		const declared = setupDeclaringPhasedPlan();
		const first = await syncPlanDecisions({ cwd: declared.cwd, name: declared.name });

		expectStatus(first, 'complete');
		const afterFirst = declared.bases.map((base) => declared.readFile(base));

		const second = await syncPlanDecisions({ cwd: declared.cwd, name: declared.name });

		expectStatus(second, 'complete');
		const overviewRows = tableRows({ section: decisionLogSection({ text: declared.readFile('overview.md') }) });
		// the marker sits on the declaring row of the overview's table and nowhere
		// else, and the second run finds every file already current
		expect({
			firstReported: updatedByFile({ files: first.files }),
			secondReported: updatedByFile({ files: second.files }),
			markedRows: overviewRows.map((row) => row.includes('The second phase (affects phase2-extra.md)')),
			undeclaredRowMarked: overviewRows[1]?.includes('(affects'),
			phaseFilesMarked: ['phase1-core.md', 'phase2-extra.md'].map((base) => declared.readFile(base).includes('(affects')),
			texts: declared.bases.map((base) => declared.readFile(base)),
		}).toStrictEqual({
			firstReported: { 'overview.md': true, 'phase1-core.md': true, 'phase2-extra.md': true },
			secondReported: { 'overview.md': false, 'phase1-core.md': false, 'phase2-extra.md': false },
			markedRows: [true, false],
			undeclaredRowMarked: false,
			phaseFilesMarked: [false, false],
			texts: afterFirst,
		});
	});

	test('syncPlanDecisions: fails with the resolution error when no plan answers to the name', async () => {
		const plan = setupSinglePlan();

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: 'no-such-plan' });

		expectStatus(result, 'failed');
		// the resolution error comes back rather than a throw, and it names what
		// was looked for
		expect(result.error).toMatch(/no-such-plan/);
		// the plan that does exist is left exactly as it was written
		expect(plan.readPlan()).toBe(planBody({ title: 'Decision Log' }));
	});

	test('syncPlanDecisions: fails naming overview.md when phase files resolve without one and writes nothing', async () => {
		const phased = setupPhasedPlan({ overview: false });
		const before = ['phase1-core.md', 'phase2-wire.md'].map((base) => phased.readFile(base));

		const result = await syncPlanDecisions({ cwd: phased.cwd, name: phased.name });

		expectStatus(result, 'failed');
		// the table has nowhere to live, so no phase file is touched either
		expect({ error: result.error, texts: ['phase1-core.md', 'phase2-wire.md'].map((base) => phased.readFile(base)) }).toEqual({
			error: expect.stringContaining('overview.md'),
			texts: before,
		});
	});

	test('syncPlanDecisions: fails naming decisions.json and writes nothing when the record is missing', async () => {
		const plan = setupSinglePlan({ record: false });

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: plan.name });

		expectStatus(result, 'failed');
		expect({ error: result.error, text: plan.readPlan() }).toEqual({
			error: expect.stringContaining('decisions.json'),
			text: planBody({ title: 'Decision Log' }),
		});
	});

	test('syncPlanDecisions: renders the record it was handed instead of reading the workspace', async () => {
		const plan = setupSinglePlan({ record: false });
		const decisions: DecisionsRecord = {
			planName: plan.name,
			decisions: [decisionRow({ question: 'Whose rows are these?', choice: 'The ones the caller handed in' })],
		};

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: plan.name, decisions });

		expectStatus(result, 'complete');
		const section = decisionLogSection({ text: plan.readPlan() });
		// there is no decisions.json to read, so a synced table proves the handed
		// rows were the ones rendered
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: tableRows({ section }).length,
			choice: section.includes('The ones the caller handed in'),
		}).toStrictEqual({ reported: { 'plan.md': true }, rows: 1, choice: true });
	});

	test('syncPlanDecisions: syncs the paths it is handed for a workspace whose deliverable does not resolve', async () => {
		const draft = setupOverviewOnly();
		const decisions: DecisionsRecord = {
			planName: draft.name,
			decisions: [decisionRow({ question: 'Which record is rendered?', choice: 'The one the draft is holding' })],
		};

		const result = await syncPlanDecisions({ cwd: draft.cwd, name: draft.name, planPaths: [draft.overviewPath], decisions });

		expectStatus(result, 'complete');
		const section = decisionLogSection({ text: draft.readFile('overview.md') });
		// stated paths and a stated record together: neither the deliverable nor the
		// workspace's own decisions.json is read, and the overview still gets the table
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: tableRows({ section }).length,
			handedChoice: section.includes('The one the draft is holding'),
		}).toStrictEqual({ reported: { 'overview.md': true }, rows: 1, handedChoice: true });
	});

	test('syncPlanDecisions: fails on that same overview-only workspace when it is handed no paths', async () => {
		const draft = setupOverviewOnly();

		const result = await syncPlanDecisions({ cwd: draft.cwd, name: draft.name });

		expectStatus(result, 'failed');
		// the resolver reads an overview with no phase file beside it as no plan, so
		// the stated paths above are what made the difference — and nothing is written
		expect({ error: result.error, text: draft.readFile('overview.md') }).toEqual({
			error: expect.stringContaining('no plan found'),
			text: planBody({ title: 'Overview' }),
		});
	});

	test('syncPlanDecisions: picks each handed path a rendering from its name and leaves every other file alone', async () => {
		const phased = setupPhasedPlan();

		const result = await syncPlanDecisions({
			cwd: phased.cwd,
			name: phased.name,
			planPaths: [phased.path('overview.md'), phased.path('phase1-core.md')],
		});

		expectStatus(result, 'complete');
		const overview = decisionLogSection({ text: phased.readFile('overview.md') });
		const first = decisionLogSection({ text: phased.readFile('phase1-core.md') });

		// the name decides the rendering for a stated path exactly as it does for a
		// resolved one, and the phase file left out of the list is untouched
		expect({
			reported: updatedByFile({ files: result.files }),
			overviewRows: tableRows({ section: overview }).length,
			firstRows: tableRows({ section: first }).length,
			firstPoints: first.includes('overview.md'),
			second: phased.readFile('phase2-wire.md'),
		}).toStrictEqual({
			reported: { 'overview.md': true, 'phase1-core.md': true },
			overviewRows: 2,
			firstRows: 0,
			firstPoints: true,
			second: planBody({ title: 'Phase 2 — Wire' }),
		});
	});

	test('syncPlanDecisions: syncs handed phase paths with no overview beside them rather than refusing them', async () => {
		const phased = setupPhasedPlan({ overview: false });

		const result = await syncPlanDecisions({ cwd: phased.cwd, name: phased.name, planPaths: [phased.path('phase1-core.md')] });

		expectStatus(result, 'complete');
		const first = decisionLogSection({ text: phased.readFile('phase1-core.md') });
		// the refusal over a missing overview belongs to the resolved path only: the
		// caller that states its paths owns where the table lives
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: tableRows({ section: first }).length,
			points: first.includes('overview.md'),
		}).toStrictEqual({ reported: { 'phase1-core.md': true }, rows: 0, points: true });
	});
});
