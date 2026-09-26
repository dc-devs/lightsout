import { describe, expect, test } from '@jest/globals';
import type { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
import { DecisionSource } from '#src/contracts/plan/decisions/DecisionSource.ts';
import { renderGlobalConstraints } from '#src/plan/sections/renderGlobalConstraints.ts';

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
 * Every bullet of a rendered section, without its list marker. A constraint the
 * renderer split across two lines shows up here as two bullets rather than
 * hiding inside one, which is the failure the folding rule exists to stop.
 */
const bullets = (section: string): string[] =>
	section
		.split('\n')
		.filter((line) => line.startsWith('- '))
		.map((line) => line.slice(2).trim());

/**
 * The prose lines between the heading and the bullets — the lead-in that tells a
 * reader the section is composed rather than hand-written. The wording is
 * human-facing copy, so tests assert that a lead-in is there, never what it says.
 */
const leadIn = (section: string): string[] =>
	section
		.split('\n')
		.slice(1)
		.filter((line) => line.trim() !== '' && !line.startsWith('- ') && !line.startsWith('#'));

describe('renderGlobalConstraints', () => {
	test('renders one bullet per Global constraint row and none for any other decision', () => {
		const { decisions } = setupDecisions({
			rows: [
				{
					source: DecisionSource.Brainstorm,
					question: 'Global constraint: every new parameter is optional and unset at existing call sites',
					choice: 'Every new parameter is optional and unset at existing call sites.',
				},
				{
					source: DecisionSource.Elicitation,
					question: 'is this one plan or several?',
					choice: 'one plan',
				},
				{
					source: DecisionSource.Grill,
					question: 'Global constraint: no existing plan file turns stale',
					choice: 'No existing plan file turns stale.',
				},
			],
		});

		const section = renderGlobalConstraints({ decisions });

		// the two prefixed rows, in record order, and the ordinary decision between
		// them left out — an ordinary decision read as a rule binding the whole
		// implementation is the defect this row guards
		expect(section.startsWith('## Global Constraints\n')).toBe(true);
		expect(bullets(section)).toStrictEqual(['Every new parameter is optional and unset at existing call sites.', 'No existing plan file turns stale.']);
	});

	test('renders only the last row when two rows share one Global constraint question', () => {
		const { decisions } = setupDecisions({
			rows: [
				{
					question: 'Global constraint: which harnesses the focused environment covers',
					choice: 'Claude Code only.',
				},
				{
					question: 'is this one plan or several?',
					choice: 'one plan',
				},
				{
					question: 'Global constraint: which harnesses the focused environment covers',
					choice: 'Every harness that can express all four controls.',
				},
			],
		});

		const section = renderGlobalConstraints({ decisions });

		// the later row is the live one, so the superseded choice produces no bullet
		// at all — two bullets here would state two rules where one binds
		expect(bullets(section)).toStrictEqual(['Every harness that can express all four controls.']);
	});

	test('renders a single none bullet when the record states no constraint', () => {
		const { decisions } = setupDecisions({
			rows: [
				{ question: 'is this one plan or several?', choice: 'one plan' },
				{ question: 'who owns the repeated sections?', choice: 'the engine' },
			],
		});

		const section = renderGlobalConstraints({ decisions });

		// the heading, a lead-in line, and one bullet a reader can act on; a body
		// with no bullet leaves the section unreadable as a list of rules
		expect(section.startsWith('## Global Constraints\n')).toBe(true);
		expect(leadIn(section).length).toBeGreaterThan(0);
		expect(bullets(section)).toHaveLength(1);
		expect(bullets(section)[0]).toMatch(/none/i);
	});

	test('folds a multi-line choice into one bullet line', () => {
		const { decisions } = setupDecisions({
			rows: [
				{
					question: 'Global constraint: the repair loop never rewrites design text',
					choice: '  The repair loop never rewrites design text,\nand no section holds prose an agent must keep.  ',
				},
			],
		});

		const section = renderGlobalConstraints({ decisions });

		// one bullet carrying the whole choice, not two: the break inside the choice
		// is folded and the surrounding whitespace trimmed, so the rule reads as the
		// single rule it is
		const rendered = bullets(section);
		expect(rendered).toHaveLength(1);
		expect(rendered[0]).toContain('The repair loop never rewrites design text,');
		expect(rendered[0]).toContain('and no section holds prose an agent must keep.');
		// and no line of the section holds the second half on its own, which is how
		// an unfolded break reads: a second constraint nobody stated
		expect(section.split('\n').some((line) => line.trim() === 'and no section holds prose an agent must keep.')).toBe(false);
	});
});
