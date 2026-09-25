import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
import { syncPlanDecisions } from '#src/plan/decisionLog/syncPlanDecisions.ts';
import {
	decisionLogPlanBody,
	decisionTableRows,
	planDecisionRow,
	planSectionBody,
	seedPlanDecisions,
	setupDecisionLogPlan,
	setupPhasedDecisionLogPlan,
	twoDecisionRows,
	updatedByFile,
} from '#tests/helpers/decisionLogPlan.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { writePhasedPlanDeliverable } from '#tests/helpers/writePhasedPlanDeliverable.ts';

// The runner owns the whole deliverable: `plan.md` and `overview.md` carry the
// rendered table, every phase file carries the pointer at the overview, and a
// deliverable that cannot resolve — no plan, no overview, no record — is
// refused before the first byte is written.

/** How many entries the result carries for each basename — one sync of two sections still reports one line per file. */
const entriesByFile = ({ files }: { files: { path: string }[] }) => {
	const counts: Record<string, number> = {};

	for (const file of files) {
		const key = basename(file.path);

		counts[key] = (counts[key] ?? 0) + 1;
	}

	return counts;
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
			'overview.md': decisionLogPlanBody({ title: 'Overview' }),
			'phase1-core.md': decisionLogPlanBody({ title: 'Phase 1 — Core' }),
			'phase2-extra.md': decisionLogPlanBody({ title: 'Phase 2 — Extra' }),
		},
	});
	const rows: DecisionRow[] = [
		{ ...planDecisionRow({ question: 'Which phase carries the extra wiring?', choice: 'The second phase' }), phases: ['phase2-extra.md'] },
		planDecisionRow({ question: 'Who writes the log?', choice: 'The engine, never a writer' }),
	];

	seedPlanDecisions({ dir, name, rows });

	return { cwd, name, bases, readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};

/** The shared body with its project-wide rules hand-written too, so neither engine-composed section is what the record would compose. */
const staleBody = ({ title }: { title: string }) =>
	decisionLogPlanBody({ title, constraints: '- Whatever rule the writer typed here before the engine owned the section' });

/** A phased deliverable whose files all carry a hand-written Decision Log and a hand-written constraints bullet, beside a record holding one project-wide rule. */
const setupStaleSectionsPlan = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-sync-'));
	const name = 'stale-sections';
	const bases = ['overview.md', 'phase1-core.md', 'phase2-wire.md'];
	const dir = writePhasedPlanDeliverable({
		cwd,
		name,
		files: {
			'overview.md': staleBody({ title: 'Overview' }),
			'phase1-core.md': staleBody({ title: 'Phase 1 — Core' }),
			'phase2-wire.md': staleBody({ title: 'Phase 2 — Wire' }),
		},
	});
	const constraint = planDecisionRow({
		question: 'Global constraint: how is this machinery to be changed?',
		choice: 'The grading machinery is restructured for modularity, not patched around',
	});

	seedPlanDecisions({ dir, name, rows: [...twoDecisionRows, constraint] });

	return { cwd, name, bases, readFile: (base: string) => readFileSync(join(dir, base), 'utf8') };
};

describe('syncPlanDecisions', () => {
	test('syncPlanDecisions: writes the full table into a single plan and reports it updated', async () => {
		const plan = setupDecisionLogPlan();

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: plan.name });

		expectStatus(result, 'complete');
		const section = planSectionBody({ heading: 'Decision Log', text: plan.readPlan() });
		// one table row per record, the choices written through, and no pointer at
		// an overview a single plan does not have
		expect({
			reported: updatedByFile({ files: result.files }),
			rows: decisionTableRows({ section }).length,
			firstChoice: section.includes('In the overview'),
			secondChoice: section.includes('The engine, never a writer'),
			pointsElsewhere: section.includes('overview.md'),
		}).toStrictEqual({ reported: { 'plan.md': true }, rows: 2, firstChoice: true, secondChoice: true, pointsElsewhere: false });
	});

	test('syncPlanDecisions: gives the overview the table and every phase file the reference', async () => {
		const phased = setupPhasedDecisionLogPlan();

		const result = await syncPlanDecisions({ cwd: phased.cwd, name: phased.name });

		expectStatus(result, 'complete');
		const overview = planSectionBody({ heading: 'Decision Log', text: phased.readFile('overview.md') });
		const first = planSectionBody({ heading: 'Decision Log', text: phased.readFile('phase1-core.md') });
		const second = planSectionBody({ heading: 'Decision Log', text: phased.readFile('phase2-wire.md') });

		// the table has exactly one home, and each phase points at it
		expect({
			reported: updatedByFile({ files: result.files }),
			overviewRows: decisionTableRows({ section: overview }).length,
			firstRows: decisionTableRows({ section: first }).length,
			secondRows: decisionTableRows({ section: second }).length,
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
		const phased = setupPhasedDecisionLogPlan();
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
		const overviewRows = decisionTableRows({ section: planSectionBody({ heading: 'Decision Log', text: declared.readFile('overview.md') }) });
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
		const plan = setupDecisionLogPlan();

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: 'no-such-plan' });

		expectStatus(result, 'failed');
		// the resolution error comes back rather than a throw, and it names what
		// was looked for
		expect(result.error).toMatch(/no-such-plan/);
		// the plan that does exist is left exactly as it was written
		expect(plan.readPlan()).toBe(decisionLogPlanBody({ title: 'Decision Log' }));
	});

	test('syncPlanDecisions: fails naming overview.md when phase files resolve without one and writes nothing', async () => {
		const phased = setupPhasedDecisionLogPlan({ overview: false });
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
		const plan = setupDecisionLogPlan({ record: false });

		const result = await syncPlanDecisions({ cwd: plan.cwd, name: plan.name });

		expectStatus(result, 'failed');
		expect({ error: result.error, text: plan.readPlan() }).toEqual({
			error: expect.stringContaining('decisions.json'),
			text: decisionLogPlanBody({ title: 'Decision Log' }),
		});
	});

	test('syncPlanDecisions: a stale Global Constraints section is recomposed beside the Decision Log', async () => {
		const stale = setupStaleSectionsPlan();
		const first = await syncPlanDecisions({ cwd: stale.cwd, name: stale.name });

		expectStatus(first, 'complete');
		const afterFirst = stale.bases.map((base) => stale.readFile(base));

		const second = await syncPlanDecisions({ cwd: stale.cwd, name: stale.name });

		expectStatus(second, 'complete');
		// one run recomposes both engine-owned sections of every file and reports
		// each file once, and the run after it finds the deliverable current
		expect({
			firstReported: updatedByFile({ files: first.files }),
			entries: entriesByFile({ files: first.files }),
			secondReported: updatedByFile({ files: second.files }),
			constraintWritten: stale.bases.map((base) =>
				planSectionBody({ text: stale.readFile(base), heading: 'Global Constraints' }).includes(
					'- The grading machinery is restructured for modularity, not patched around',
				),
			),
			handEditRemains: stale.bases.map((base) => stale.readFile(base).includes('Whatever rule the writer typed here')),
			logRows: decisionTableRows({ section: planSectionBody({ heading: 'Decision Log', text: stale.readFile('overview.md') }) }).length,
			phasePoints: stale.readFile('phase1-core.md').includes('overview.md'),
			texts: stale.bases.map((base) => stale.readFile(base)),
		}).toStrictEqual({
			firstReported: { 'overview.md': true, 'phase1-core.md': true, 'phase2-wire.md': true },
			entries: { 'overview.md': 1, 'phase1-core.md': 1, 'phase2-wire.md': 1 },
			secondReported: { 'overview.md': false, 'phase1-core.md': false, 'phase2-wire.md': false },
			constraintWritten: [true, true, true],
			handEditRemains: [false, false, false],
			logRows: 3,
			phasePoints: true,
			texts: afterFirst,
		});
	});
});
