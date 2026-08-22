import { describe, expect, test } from '@jest/globals';
import { buildPlanReshapeInvocation } from '#src/agents/index.ts';
import type { StructuralFinding } from '#src/contracts/index.ts';

/** A full breakdown StructuralFinding with per-test overrides. */
const finding = (overrides: Partial<StructuralFinding> = {}): StructuralFinding => ({
	check: 'created-files-within-ceiling',
	severity: 'blocking',
	phase: 'overview.md',
	issue: 'phase 2 declares 41 created files, over the ceiling of 30',
	location: 'Phases table, row 2',
	fix: 'split this phase into two in the `## Phases` table and `## Phase Declarations`',
	...overrides,
});

/** The overview path, ceiling and workspace reference paths a reshape invocation is built from. */
const setupReshape = ({
	findings = [finding()],
	planPaths = ['/tmp/.lightsout/plans/widget-flag/overview.md'],
	createdFileCeiling = 30,
	brainstormDecisionsPath,
}: {
	findings?: StructuralFinding[];
	planPaths?: string[];
	createdFileCeiling?: number;
	brainstormDecisionsPath?: string;
} = {}) => ({
	findings,
	planPaths,
	createdFileCeiling,
	decisionsPath: '/tmp/.lightsout/plans/widget-flag/decisions.json',
	brainstormDecisionsPath,
	factsPath: '/tmp/.lightsout/plans/widget-flag/facts.json',
});

describe('buildPlanReshapeInvocation', () => {
	test('the prompt opens with the reshape marker and carries every section the role prompt promises', () => {
		const params = setupReshape();

		const { prompt } = buildPlanReshapeInvocation(params);

		// the marker that distinguishes a reshape invocation from a repair one
		expect(prompt.startsWith('# Reshape input')).toBeTruthy();
		expect(prompt.includes('## Overview file to reshape (Edit in place)')).toBeTruthy();
		expect(prompt.includes('## Created-file ceiling')).toBeTruthy();
		expect(prompt.includes('## Breakdown findings to resolve')).toBeTruthy();
		expect(prompt.includes('## Reference files (Read on demand)')).toBeTruthy();
		// the closing reminder names the report contract and the touch-nothing-else rule
		expect(prompt).toMatch(/PlanFixReport/);
		expect(prompt).toMatch(/re-split the phase breakdown, touch nothing else/);
	});

	test('the overview path renders as a `- <path>` bullet under its own section', () => {
		const params = setupReshape();

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(prompt.includes('## Overview file to reshape (Edit in place)\n\n- /tmp/.lightsout/plans/widget-flag/overview.md')).toBeTruthy();
	});

	test('several plan paths each get their own bullet, in the order given', () => {
		const params = setupReshape({ planPaths: ['/tmp/plans/overview.md', '/tmp/plans/overview-alt.md'] });

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(prompt.includes('- /tmp/plans/overview.md\n- /tmp/plans/overview-alt.md')).toBeTruthy();
	});

	test('the created-file ceiling is stated as the number the check applies, with no declaration raising it', () => {
		const params = setupReshape({ createdFileCeiling: 30 });

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(
			prompt.includes('## Created-file ceiling\n\nNo phase may declare more than 30 created source files. This is fixed and no declaration raises it.'),
		).toBeTruthy();
	});

	test('a different ceiling is carried verbatim rather than restated from a literal', () => {
		const params = setupReshape({ createdFileCeiling: 12 });

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(prompt.includes('No phase may declare more than 12 created source files.')).toBeTruthy();
	});

	test('each finding carries its check, location, issue and exact fix string', () => {
		const params = setupReshape({
			findings: [
				finding(),
				finding({
					check: 'declaration-consistent',
					issue: 'phase 3 Creates cell is not an integer',
					location: 'Phases table, row 3',
					fix: 'write an integer in the Creates cell',
				}),
			],
		});

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(
			prompt.includes(
				'- [created-files-within-ceiling] Phases table, row 2 — phase 2 declares 41 created files, over the ceiling of 30\n  fix: split this phase into two in the `## Phases` table and `## Phase Declarations`',
			),
		).toBeTruthy();
		expect(
			prompt.includes('- [declaration-consistent] Phases table, row 3 — phase 3 Creates cell is not an integer\n  fix: write an integer in the Creates cell'),
		).toBeTruthy();
	});

	test('decisions and facts arrive as paths to Read, never as inlined content', () => {
		const params = setupReshape();

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(prompt.includes('- Decisions record: /tmp/.lightsout/plans/widget-flag/decisions.json')).toBeTruthy();
		expect(prompt.includes('- Verified facts: /tmp/.lightsout/plans/widget-flag/facts.json')).toBeTruthy();
		// an arithmetic re-split never pays for the reference content
		expect(prompt.includes('```json')).toBeFalsy();
	});

	test('without a brainstorm path the reference section lists exactly the two workspace files', () => {
		const params = setupReshape();

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(
			prompt.includes(
				'## Reference files (Read on demand)\n\n- Decisions record: /tmp/.lightsout/plans/widget-flag/decisions.json\n- Verified facts: /tmp/.lightsout/plans/widget-flag/facts.json',
			),
		).toBeTruthy();
		expect(prompt.includes('Brainstorm decisions')).toBeFalsy();
	});

	test('a brainstorm path lists both decision files, the brainstorm one labelled as settled before planning', () => {
		const params = setupReshape({ brainstormDecisionsPath: '/tmp/.lightsout/plans/widget-flag/brainstorm-decisions.json' });

		const { prompt } = buildPlanReshapeInvocation(params);

		// the full section pins the order: plan decisions first, brainstorm second, facts closing
		expect(
			prompt.includes(
				'## Reference files (Read on demand)\n\n- Decisions record: /tmp/.lightsout/plans/widget-flag/decisions.json\n- Brainstorm decisions (settled during brainstorm, before planning began): /tmp/.lightsout/plans/widget-flag/brainstorm-decisions.json\n- Verified facts: /tmp/.lightsout/plans/widget-flag/facts.json',
			),
		).toBeTruthy();
	});

	test('the system prompt is the reshaper role — the one plan-editing role allowed to restructure', () => {
		const params = setupReshape();

		const { systemPrompt, prompt } = buildPlanReshapeInvocation(params);

		expect(systemPrompt).toMatch(/Plan Reshaper/);
		// the reshaper's whole job is the restructuring the repairer forbids
		expect(systemPrompt).toMatch(/re-split/i);
		// it is never the narrow repairer, whose prompt bans restructuring
		expect(systemPrompt.includes('Plan Repairer')).toBeFalsy();
		// no authoring template for an editing role
		expect(systemPrompt.includes('# Plan Template')).toBeFalsy();
		// a reshape invocation can never read as a repair or an author invocation
		expect(prompt.includes('# Repair input')).toBeFalsy();
		expect(prompt.includes('# Draft input')).toBeFalsy();
	});

	test('sections are joined by a blank line, so the assembled prompt is one flat document', () => {
		const params = setupReshape();

		const { prompt } = buildPlanReshapeInvocation(params);

		expect(prompt.includes('# Reshape input\n\n## Overview file to reshape (Edit in place)')).toBeTruthy();
	});
});
