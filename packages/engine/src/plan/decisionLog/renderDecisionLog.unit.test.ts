import { describe, expect, test } from '@jest/globals';
import { type DecisionRow, DecisionSource } from '#src/contracts/index.ts';
import { renderDecisionLog } from '#src/plan/decisionLog/renderDecisionLog.ts';

/**
 * The merged rows the renderer is handed, in record order. Every row is a
 * complete `DecisionRow`; a test states only the fields its criterion turns on.
 */
const setupDecisions = ({ rows = [] }: { rows?: Partial<DecisionRow>[] } = {}) => {
	const decisions: DecisionRow[] = rows.map((overrides, index) => ({
		source: DecisionSource.Elicitation,
		question: `question ${index + 1}`,
		options: 'option a / option b',
		choice: `choice ${index + 1}`,
		rationale: `rationale ${index + 1}`,
		assumption: false,
		...overrides,
	}));

	return { decisions };
};

/**
 * Every table line of a rendered section, as its cells. Splitting on pipes the
 * renderer did NOT escape is the point: an unescaped pipe inside a cell shows
 * up here as an extra cell rather than hiding inside the text.
 */
const tableCells = (section: string): string[][] =>
	section
		.split('\n')
		.filter((line) => line.startsWith('|'))
		.map((line) =>
			line
				.split(/(?<!\\)\|/)
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

describe('renderDecisionLog', () => {
	test('renderDecisionLog: writes one numbered row per decision in record order under the six template columns', () => {
		const { decisions } = setupDecisions({
			rows: [
				{
					source: DecisionSource.Brainstorm,
					question: 'which drafting improvements are in scope?',
					options: 'one coordinated improvement / a broader rewrite',
					choice: 'one coordinated improvement',
					rationale: 'keeps the ticket buildable',
				},
				{
					source: DecisionSource.Elicitation,
					question: 'is this one plan or several?',
					options: 'one plan / three plans',
					choice: 'one plan',
					rationale: 'nothing here stands alone',
				},
				{
					source: DecisionSource.Grill,
					question: 'where does the table live in a phased plan?',
					options: 'the overview / every phase file',
					choice: 'the overview',
					rationale: 'one history, referenced everywhere else',
				},
			],
		});

		const section = renderDecisionLog({ decisions });

		const cells = tableCells(section);
		expect(section.startsWith('## Decision Log\n')).toBe(true);
		// the note line names the command that composes the section, so a reader
		// who finds it stale knows what to run
		expect(section).toContain('lightsout plan sync-decisions');
		expect(cells[0]).toStrictEqual(['#', 'Source', 'Decision / Question', 'Options Considered', 'Choice', 'Rationale']);
		// row 1 is the brainstorm row and rows 2 and 3 follow it in record order
		expect(cells.slice(2)).toStrictEqual([
			[
				'1',
				'Brainstorm',
				'which drafting improvements are in scope?',
				'one coordinated improvement / a broader rewrite',
				'one coordinated improvement',
				'keeps the ticket buildable',
			],
			['2', 'Elicitation', 'is this one plan or several?', 'one plan / three plans', 'one plan', 'nothing here stands alone'],
			[
				'3',
				'Grill',
				'where does the table live in a phased plan?',
				'the overview / every phase file',
				'the overview',
				'one history, referenced everywhere else',
			],
		]);
	});

	test('renderDecisionLog: escapes a pipe and folds a line break so one decision stays one table row', () => {
		const { decisions } = setupDecisions({
			rows: [
				{
					question: 'which file carries the table?',
					options: 'plan.md / overview.md',
					choice: 'plan.md | overview.md\nwhichever the deliverable resolves',
					rationale: '  the table has to have a home  ',
				},
			],
		});

		const section = renderDecisionLog({ decisions });

		// six cells, not seven: the pipe inside the choice is escaped rather than
		// splitting the row, and the break folds into a line-break tag
		expect(tableCells(section).slice(2)).toStrictEqual([
			[
				'1',
				'Elicitation',
				'which file carries the table?',
				'plan.md / overview.md',
				'plan.md \\| overview.md<br>whichever the deliverable resolves',
				'the table has to have a home',
			],
		]);
	});

	test('renderDecisionLog: marks only the assumption row in its Choice cell', () => {
		const { decisions } = setupDecisions({
			rows: [{ choice: 'confirmed by the human' }, { choice: 'chosen without confirmation', assumption: true }],
		});

		const section = renderDecisionLog({ decisions });

		const choices = tableCells(section)
			.slice(2)
			.map((row) => row[4]);
		expect(choices[0]).toBe('confirmed by the human');
		expect(choices[1]).toContain('chosen without confirmation');
		expect(choices[1]).toContain('(assumption)');
	});

	test('renderDecisionLog: points every earlier row with a repeated question at the row that supersedes it', () => {
		const { decisions } = setupDecisions({
			rows: [
				{ question: 'where does the sync run?', choice: 'in the repair loop only' },
				{ question: 'who writes the section?', choice: 'the engine' },
				{ question: 'where does the sync run?', choice: 'at every consumer boundary' },
			],
		});

		const section = renderDecisionLog({ decisions });

		const choices = tableCells(section)
			.slice(2)
			.map((row) => row[4]);
		// the last row carrying a question is the binding one, so it is the target
		// of the marker rather than a marked row itself
		expect(choices[0]).toContain('(superseded by #3)');
		expect(choices[1]).toBe('the engine');
		expect(choices[2]).toBe('at every consumer boundary');
	});

	test('renderDecisionLog: states no decisions are recorded instead of an empty table', () => {
		const { decisions } = setupDecisions();

		const section = renderDecisionLog({ decisions });

		expect(section.startsWith('## Decision Log\n')).toBe(true);
		expect(section).toContain('lightsout plan sync-decisions');
		expect(section).toContain('No decisions recorded.');
		// a header-only table would be a table with no history in it
		expect(tableCells(section)).toStrictEqual([]);
	});
});
