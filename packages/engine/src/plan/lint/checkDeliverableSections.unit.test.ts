import { describe, expect, test } from '@jest/globals';
import { type DecisionRow, DecisionSource, type DecisionsRecord } from '#src/contracts/index.ts';
import { decisionLogReference, renderDecisionLog } from '#src/plan/decisionLog/index.ts';
import { checkDeliverableSections } from '#src/plan/lint/index.ts';
import { renderGlobalConstraints } from '#src/plan/sections/index.ts';

/**
 * One plan file's text: the two engine-composed sections in the order every plan
 * carries them, under enough authored prose for each section to have a line
 * number of its own.
 */
const planText = ({ title, decisionLog, constraints }: { title: string; decisionLog: string; constraints: string }) =>
	`# ${title}\n\n## Context\n\nA plan that exists to be linted.\n\n${decisionLog}\n\n${constraints}\n`;

/**
 * One phased deliverable of three files, judged against one record: the overview
 * carrying both sections as the engine composes them, the first phase file
 * carrying a hand-edited `## Decision Log`, and the second a hand-edited
 * `## Global Constraints`.
 *
 * Two files are stale for two different reasons, so a pass that checked only the
 * log would report one finding where the deliverable has two.
 */
const setupStaleDeliverable = () => {
	const rows: DecisionRow[] = [
		{
			source: DecisionSource.Brainstorm,
			question: 'Global constraint: how is this machinery to be changed?',
			options: 'patch the carve-outs / restructure it',
			choice: 'The grading machinery is restructured for modularity and control, not patched around.',
			rationale: 'the user stated this as the condition of the work',
			assumption: false,
		},
		{
			source: DecisionSource.Elicitation,
			question: 'is this one plan or several?',
			options: 'one plan / one phased plan / several plans',
			choice: 'one plan, phased',
			rationale: 'the brainstorm settled it as one buildable idea',
			assumption: false,
		},
	];
	const decisions: DecisionsRecord = { planName: 'demo-plan', decisions: rows };
	const constraints = renderGlobalConstraints({ decisions: rows });
	const staleLog = decisionLogReference().replace('Do not edit by hand.', 'Rewritten by hand.');
	const staleConstraints = constraints.replace(
		'The grading machinery is restructured for modularity and control, not patched around.',
		'The grading machinery is patched around wherever that is quicker.',
	);

	return {
		params: {
			cwd: '/repo',
			name: 'demo-plan',
			overviewText: planText({ title: 'Demo Plan — Overview', decisionLog: renderDecisionLog({ decisions: rows }), constraints }),
			files: [
				{ path: '/repo/plans/demo-plan/phase1-demo.md', text: planText({ title: 'Demo Plan — Phase 1', decisionLog: staleLog, constraints }) },
				{
					path: '/repo/plans/demo-plan/phase2-demo.md',
					text: planText({ title: 'Demo Plan — Phase 2', decisionLog: decisionLogReference(), constraints: staleConstraints }),
				},
			],
			decisions,
		},
	};
};

describe('checkDeliverableSections', () => {
	test('checkDeliverableSections: a stale Global Constraints section is reported beside a stale Decision Log', () => {
		const { params } = setupStaleDeliverable();

		const findings = checkDeliverableSections(params);

		// one finding per stale section, each labelled and located by its own file,
		// and nothing at all against the overview, whose two sections are current
		expect(findings).toEqual([
			expect.objectContaining({
				check: 'decision-log-current',
				severity: 'blocking',
				phase: 'phase1-demo.md',
				location: expect.stringContaining('phase1-demo.md:'),
				fix: expect.stringContaining('plan sync-decisions --name demo-plan --cwd "/repo"'),
			}),
			expect.objectContaining({
				check: 'global-constraints-current',
				severity: 'blocking',
				phase: 'phase2-demo.md',
				location: expect.stringContaining('phase2-demo.md:'),
				fix: expect.stringContaining('plan sync-decisions --name demo-plan --cwd "/repo"'),
			}),
		]);
	});
});
