import { describe, expect, test } from '@jest/globals';
import { buildFocusedPlanWriterInvocation } from '#src/agents/buildFocusedPlanWriterInvocation/index.ts';
import { PlanVariant } from '#src/contracts/index.ts';

const setup = ({ variants = [PlanVariant.Phase] }: { variants?: PlanVariant[] } = {}) => ({
	authoritativePacket: {
		systemPrompt: 'Exact standards: retain completed uploads.',
		prompt: JSON.stringify({
			claims: [{ id: 'original', text: 'Preserve every completed upload after retry failure.' }],
			evidence: [{ content: 'Full source evidence | even after a newline\nsecond line' }],
		}),
	},
	outputs: variants.map((variant) => ({ path: `${variant}.md`, variant })),
	limits: { executorFileLimit: 47, createdFileCeiling: 23 },
});

describe('buildFocusedPlanWriterInvocation', () => {
	test.each([
		{ variants: [PlanVariant.Single], present: ['Single Plan'], absent: ['Overview Plan', 'Phase Plan'] },
		{ variants: [PlanVariant.Overview], present: ['Overview Plan'], absent: ['Single Plan', 'Phase Plan'] },
		{ variants: [PlanVariant.Phase, PlanVariant.Phase], present: ['Single Plan', 'Phase Plan'], absent: ['Overview Plan'] },
	])('carries only the applicable template variants for $variants', ({ variants, present, absent }) => {
		const input = setup({ variants });

		const invocation = buildFocusedPlanWriterInvocation(input);

		expect(invocation.systemPrompt.startsWith(input.authoritativePacket.systemPrompt)).toBe(true);
		expect(invocation.systemPrompt).toContain('## Rules (all variants)');
		for (const heading of present) expect(invocation.systemPrompt.split(`\n## ${heading}\n`)).toHaveLength(2);
		for (const heading of absent) expect(invocation.systemPrompt).not.toContain(`\n## ${heading}\n`);
		expect(invocation.systemPrompt).not.toContain('{{');
		expect(invocation.systemPrompt).toContain('47');
		expect(JSON.parse(invocation.prompt)).toEqual({
			...JSON.parse(input.authoritativePacket.prompt),
			authoring: {
				outputs: input.outputs,
				engineOwnedSections: expect.arrayContaining(['Acceptance Tests', 'Planning Provenance', 'Phase Declarations']),
			},
		});
	});

	test('keeps documentation, exact typed obligations and transactional publication instructions in the authoritative writer', () => {
		const input = { ...setup(), docs: [{ path: 'README.md', covers: 'Every externally visible retry guarantee.' }] };

		const invocation = buildFocusedPlanWriterInvocation(input);

		expect(invocation.systemPrompt).toContain('README.md');
		expect(invocation.systemPrompt).toContain('Every externally visible retry guarantee.');
		expect(invocation.systemPrompt).toContain('transactional artifactEdits');
		expect(invocation.systemPrompt).toContain('exact test file, test name and gate');
		expect(invocation.systemPrompt).toContain('Unrecognized authored content must be retained');
		expect(invocation.systemPrompt).toContain('Preserve every unchanged sibling');
	});

	test('supports semantic-only repair without adding an unassigned file template', () => {
		const input = setup({ variants: [] });

		const invocation = buildFocusedPlanWriterInvocation(input);

		expect(JSON.parse(invocation.prompt).authoring.outputs).toEqual([]);
		expect(invocation.systemPrompt).toContain('## Rules (all variants)');
		expect(invocation.systemPrompt).not.toContain('\n## Single Plan\n');
		expect(invocation.systemPrompt).not.toContain('\n## Phase Plan\n');
	});
});
