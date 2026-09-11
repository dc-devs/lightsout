import { describe, expect, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, type DecisionsRecord } from '#src/contracts/index.ts';
import { decisionLogReference, renderDecisionLog } from '#src/plan/decisionLog/index.ts';
import { checkDecisionLog } from '#src/plan/lint/index.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';

/** The remedy every finding's `fix` has to name, exactly as `buildPlanSyncDecisionsCommand` hands it over. */
const syncCommand = 'node /repo/cli.mjs plan sync-decisions --name demo-plan --cwd "/repo"';

/**
 * The lines above the Decision Log, fixed so the section's own start line is
 * knowable: the heading always lands on line 7, which is the line a stale-log
 * finding has to point at.
 */
const preamble = ['# Demo Plan', '', '## Context', '', 'A plan that exists to be linted.', ''];

/** The lines below it. `## Global Constraints` closes the Decision Log's line range. */
const epilogue = ['## Global Constraints', '', 'None.', ''];

/**
 * One plan file and the record its log is judged against.
 *
 * `carries` says what the file's own `## Decision Log` holds — the rendered
 * table, the phase pointer sentence, or no such heading at all — and `edit`
 * alters that text for a case that needs the file and the record to disagree.
 */
const setupCheck = ({
	rows = [],
	carries = 'table',
	edit = (section: string) => section,
	base = 'plan.md',
	phased = false,
}: {
	rows?: Partial<DecisionRow>[];
	carries?: 'table' | 'pointer' | 'nothing';
	edit?: (section: string) => string;
	base?: string;
	phased?: boolean;
} = {}) => {
	const decisions: DecisionsRecord = {
		planName: 'demo-plan',
		decisions: rows.map((overrides, index) => ({
			source: DecisionSource.Elicitation,
			question: `question ${index + 1}`,
			options: 'option a / option b',
			choice: `choice ${index + 1}`,
			rationale: `rationale ${index + 1}`,
			assumption: false,
			...overrides,
		})),
	};
	const rendered = carries === 'pointer' ? decisionLogReference() : renderDecisionLog({ decisions: decisions.decisions });
	const sectionLines = carries === 'nothing' ? [] : [...edit(rendered).split('\n'), ''];
	const plan = parsePlan({ content: [...preamble, ...sectionLines, ...epilogue].join('\n'), base });

	return { params: { plan, phase: base, decisions, phased, syncCommand } };
};

/** Both halves of the empty-record case: the plan carrying the section an empty record renders, and the plan carrying no section at all. */
const setupEmptyRecordFiles = () => ({
	carrying: setupCheck({ rows: [] }).params,
	absent: setupCheck({ rows: [], carries: 'nothing' }).params,
});

/** The four files of one phased deliverable: each of the two shapes carrying each of the two sections. */
const setupPhasedFiles = () => {
	const rows = [{ question: 'where does the complete history live?' }];
	const phaseBase = 'phase1-demo.md';

	return {
		phaseWithPointer: setupCheck({ rows, carries: 'pointer', base: phaseBase, phased: true }).params,
		phaseWithTable: setupCheck({ rows, carries: 'table', base: phaseBase, phased: true }).params,
		overviewWithTable: setupCheck({ rows, carries: 'table', base: 'overview.md', phased: true }).params,
		overviewWithPointer: setupCheck({ rows, carries: 'pointer', base: 'overview.md', phased: true }).params,
	};
};

/**
 * A phased overview whose log was synced while its second row named no phases,
 * checked against the record after that row gained `phases`. The two rows'
 * authored text is identical on both sides, so the only difference is the
 * declared phases.
 */
const setupPhasesDeclaredAfterSync = () => {
	const unchanged: DecisionRow = {
		source: DecisionSource.Elicitation,
		question: 'is the log composed from the record?',
		options: 'composed / hand-written',
		choice: 'composed',
		rationale: 'the record is the one decision history',
		assumption: false,
	};
	const undeclared: DecisionRow = {
		source: DecisionSource.Elicitation,
		question: 'which phase does the answer reach?',
		options: 'phase 2 / every phase',
		choice: 'phase 2',
		rationale: 'the finding sits on phase 2',
		assumption: false,
	};
	const declared: DecisionRow = { ...undeclared, phases: ['phase2-extra.md'] };
	const syncedBefore = renderDecisionLog({ decisions: [unchanged, undeclared] });

	return setupCheck({ rows: [unchanged, declared], edit: () => syncedBefore, base: 'overview.md', phased: true }).params;
};

describe('checkDecisionLog', () => {
	test('checkDecisionLog: a section equal to the rendered record raises nothing', () => {
		const { params } = setupCheck({
			rows: [{ source: DecisionSource.Brainstorm, question: 'how much structure does code own?' }, { question: 'where is the log placed?' }],
		});

		const findings = checkDecisionLog(params);

		expect(findings).toStrictEqual([]);
	});

	test('checkDecisionLog: a section that disagrees with the record blocks and its fix names the sync command', () => {
		const { params } = setupCheck({
			rows: [{ choice: 'generate the table from the saved record' }],
			edit: (section) => section.replace('generate the table from the saved record', 'hand-write the table'),
		});

		const findings = checkDecisionLog(params);

		expect(findings).toEqual([
			expect.objectContaining({
				check: 'decision-log-current',
				severity: 'blocking',
				phase: 'plan.md',
				// `preamble` puts the heading on line 7, which is where the section starts.
				location: 'plan.md:7',
				fix: expect.stringContaining(syncCommand),
			}),
		]);
	});

	test('checkDecisionLog: a file with no Decision Log section blocks, located at the file itself', () => {
		const { params } = setupCheck({ rows: [{ question: 'who owns the section?' }], carries: 'nothing' });

		const findings = checkDecisionLog(params);

		expect(findings).toEqual([
			expect.objectContaining({
				check: 'decision-log-current',
				severity: 'blocking',
				phase: 'plan.md',
				location: 'plan.md',
				fix: expect.stringContaining(syncCommand),
			}),
		]);
	});

	test('checkDecisionLog: a phase file wants the pointer and the overview wants the table', () => {
		const { phaseWithPointer, phaseWithTable, overviewWithTable, overviewWithPointer } = setupPhasedFiles();

		const checked = {
			phaseWithPointer: checkDecisionLog(phaseWithPointer).map((finding) => finding.check),
			phaseWithTable: checkDecisionLog(phaseWithTable).map((finding) => finding.check),
			overviewWithTable: checkDecisionLog(overviewWithTable).map((finding) => finding.check),
			overviewWithPointer: checkDecisionLog(overviewWithPointer).map((finding) => finding.check),
		};

		expect(checked).toStrictEqual({
			phaseWithPointer: [],
			phaseWithTable: ['decision-log-current'],
			overviewWithTable: [],
			overviewWithPointer: ['decision-log-current'],
		});
	});

	test('checkDecisionLog: trailing blank lines and trailing spaces do not make a section stale', () => {
		const { params } = setupCheck({
			rows: [{ question: 'does whitespace change the record?' }],
			edit: (section) =>
				`${section
					.split('\n')
					.map((line) => (line === '' ? line : `${line}   `))
					.join('\n')}\n\n`,
		});

		const findings = checkDecisionLog(params);

		expect(findings).toStrictEqual([]);
	});

	test('checkDecisionLog: an empty record still demands its rendered section', () => {
		const { carrying, absent } = setupEmptyRecordFiles();

		const checked = {
			carrying: checkDecisionLog(carrying).map((finding) => finding.check),
			absent: checkDecisionLog(absent).map((finding) => finding.check),
		};

		expect(checked).toStrictEqual({ carrying: [], absent: ['decision-log-current'] });
	});

	test('checkDecisionLog: an overview synced before a row declared phases is stale against the record', () => {
		const params = setupPhasesDeclaredAfterSync();

		const findings = checkDecisionLog(params);

		expect(findings).toEqual([
			expect.objectContaining({
				check: 'decision-log-current',
				severity: 'blocking',
				phase: 'overview.md',
				// `preamble` puts the heading on line 7, which is where the section starts.
				location: 'overview.md:7',
				fix: expect.stringContaining(syncCommand),
			}),
		]);
	});
});
