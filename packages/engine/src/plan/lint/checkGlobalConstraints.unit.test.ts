import { describe, expect, test } from '@jest/globals';
import type { DecisionRow } from '#src/contracts/plan/decisions/DecisionRow.ts';
import { DecisionSource } from '#src/contracts/plan/decisions/DecisionSource.ts';
import type { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
import { checkGlobalConstraints } from '#src/plan/lint/checkGlobalConstraints.ts';
import { parsePlan } from '#src/plan/parsePlan.ts';
import { renderGlobalConstraints } from '#src/plan/sections/renderGlobalConstraints.ts';

/** The remedy every finding's `fix` has to name, exactly as `buildPlanSyncDecisionsCommand` hands it over. */
const syncCommand = 'node /repo/cli.mjs plan sync-decisions --name demo-plan --cwd "/repo"';

/**
 * The lines above the constraints section, fixed so the section's own start line
 * is knowable: the heading always lands on line 7, which is the line a stale
 * finding has to point at.
 */
const preamble = ['# Demo Plan', '', '## Context', '', 'A plan that exists to be linted.', ''];

/** The lines below it. A second `##` heading closes the constraints section's line range. */
const epilogue = ['## Verification', '', '- `pnpm check`', ''];

/** The prefix `renderGlobalConstraints` selects a row by — a decision that binds the whole plan. */
const constraintQuestion = 'Global constraint: how is this machinery to be changed?';

/** The one settled rule the fixture's record carries, and the text a hand edit replaces. */
const constraintChoice = 'The grading machinery is restructured for modularity and control, not patched around';

/**
 * One plan file and the record its constraints section is judged against.
 *
 * `carries` says whether the file holds the rendered section at all, and `edit`
 * alters that text for a case that needs the file and the record to disagree.
 */
const setupCheck = ({
	rows = [{ question: constraintQuestion, choice: constraintChoice }],
	carries = 'section',
	edit = (section: string) => section,
	base = 'plan.md',
}: {
	rows?: Partial<DecisionRow>[];
	carries?: 'section' | 'nothing';
	edit?: (section: string) => string;
	base?: string;
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
	const rendered = renderGlobalConstraints({ decisions: decisions.decisions });
	const sectionLines = carries === 'nothing' ? [] : [...edit(rendered).split('\n'), ''];
	const plan = parsePlan({ content: [...preamble, ...sectionLines, ...epilogue].join('\n'), base });

	return { params: { plan, phase: base, decisions, syncCommand } };
};

/** One hand edit, applied the same way to every variant: the settled rule replaced by its opposite. */
const handEdit = (section: string) => section.replace(constraintChoice, 'The grading machinery is patched around');

/** The three plan-file shapes, each carrying the rendered section and each carrying a hand-edited one. */
const setupVariants = () => ({
	singleCurrent: setupCheck({ base: 'plan.md' }).params,
	singleEdited: setupCheck({ base: 'plan.md', edit: handEdit }).params,
	phaseCurrent: setupCheck({ base: 'phase1-demo.md' }).params,
	phaseEdited: setupCheck({ base: 'phase1-demo.md', edit: handEdit }).params,
	overviewCurrent: setupCheck({ base: 'overview.md' }).params,
	overviewEdited: setupCheck({ base: 'overview.md', edit: handEdit }).params,
});

describe('checkGlobalConstraints', () => {
	test('checkGlobalConstraints: a section equal to the rendered record raises nothing', () => {
		const { params } = setupCheck({
			rows: [
				{ source: DecisionSource.Brainstorm, question: constraintQuestion, choice: constraintChoice },
				{ question: 'Global constraint: what pays for a re-grade?', choice: 'Coverage is recorded once and reused' },
				{ question: 'a question binding no rule', choice: 'a choice that is no constraint' },
			],
		});

		const findings = checkGlobalConstraints(params);

		expect(findings).toStrictEqual([]);
	});

	test('checkGlobalConstraints: a hand-edited constraint blocks and its fix names the sync command', () => {
		const { params } = setupCheck({ edit: handEdit });

		const findings = checkGlobalConstraints(params);

		expect(findings).toEqual([
			expect.objectContaining({
				check: 'global-constraints-current',
				severity: 'blocking',
				phase: 'plan.md',
				// `preamble` puts the heading on line 7, which is where the section starts.
				location: 'plan.md:7',
				fix: expect.stringContaining(syncCommand),
			}),
		]);
	});

	test('checkGlobalConstraints: a file with no Global Constraints section blocks, located at the file itself', () => {
		const { params } = setupCheck({ carries: 'nothing' });

		const findings = checkGlobalConstraints(params);

		expect(findings).toEqual([
			expect.objectContaining({
				check: 'global-constraints-current',
				severity: 'blocking',
				phase: 'plan.md',
				location: 'plan.md',
				fix: expect.stringContaining(syncCommand),
			}),
		]);
	});

	test('checkGlobalConstraints: trailing blank lines and trailing spaces do not make a section stale', () => {
		const { params } = setupCheck({
			edit: (section) =>
				`${section
					.split('\n')
					.map((line) => (line === '' ? line : `${line}   `))
					.join('\n')}\n\n`,
		});

		const findings = checkGlobalConstraints(params);

		expect(findings).toStrictEqual([]);
	});

	test('checkGlobalConstraints: every plan variant is compared against the one rendered section', () => {
		const { singleCurrent, singleEdited, phaseCurrent, phaseEdited, overviewCurrent, overviewEdited } = setupVariants();

		const checked = {
			singleCurrent: checkGlobalConstraints(singleCurrent).map((finding) => `${finding.check} ${finding.location}`),
			singleEdited: checkGlobalConstraints(singleEdited).map((finding) => `${finding.check} ${finding.location}`),
			phaseCurrent: checkGlobalConstraints(phaseCurrent).map((finding) => `${finding.check} ${finding.location}`),
			phaseEdited: checkGlobalConstraints(phaseEdited).map((finding) => `${finding.check} ${finding.location}`),
			overviewCurrent: checkGlobalConstraints(overviewCurrent).map((finding) => `${finding.check} ${finding.location}`),
			overviewEdited: checkGlobalConstraints(overviewEdited).map((finding) => `${finding.check} ${finding.location}`),
		};

		expect(checked).toStrictEqual({
			singleCurrent: [],
			singleEdited: ['global-constraints-current plan.md:7'],
			phaseCurrent: [],
			phaseEdited: ['global-constraints-current phase1-demo.md:7'],
			overviewCurrent: [],
			overviewEdited: ['global-constraints-current overview.md:7'],
		});
	});
});
