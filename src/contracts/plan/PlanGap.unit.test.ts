import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { PlanGap } from '@/contracts';

const setupGap = (overrides: Record<string, unknown> = {}) => {
	const gap = {
		area: 'omitted-decision',
		gap: 'the plan never says which harness the refactor command spawns',
		decision: 'name the harness the refactor pipeline spawns',
		...overrides,
	};

	return { gap };
};

describe('PlanGap', () => {
	test('a full gap parses with the decision and its options preserved', () => {
		const { gap } = setupGap({ options: ['claude-code', 'codex'] });

		const parsed = PlanGap.parse(gap);

		assert.deepEqual(parsed, {
			area: 'omitted-decision',
			gap: 'the plan never says which harness the refactor command spawns',
			decision: 'name the harness the refactor pipeline spawns',
			options: ['claude-code', 'codex'],
		});
	});

	test('options defaults to empty when the gap-check agent offers no menu', () => {
		const { gap } = setupGap();

		const parsed = PlanGap.parse(gap);

		assert.deepEqual(parsed.options, [], 'a gap whose decision has no pre-framed choices still parses — the default keeps the options list array-safe for the skill that renders it');
	});

	test('area accepts each kind of decision-level gap the agent surfaces', () => {
		for (const area of ['underspecified-surface', 'unwired-dependency', 'insufficient-detail', 'omitted-decision', 'ambiguous-boundary', 'standards-conflict']) {
			const { gap } = setupGap({ area });

			const parsed = PlanGap.parse(gap);

			assert.equal(parsed.area, area, `${area} is one of the six gap kinds the gap-check agent may report`);
		}
	});

	test('rejects an area outside the gap kinds', () => {
		const { gap } = setupGap({ area: 'missing-context' });

		const result = PlanGap.safeParse(gap);

		assert.equal(result.success, false, 'an invented area is caught at the agent boundary, before it reaches a grade report a human reads');
	});

	test('rejects the capitalized key form of an area', () => {
		const { gap } = setupGap({ area: 'OmittedDecision' });

		const result = PlanGap.safeParse(gap);

		assert.equal(result.success, false, 'the enum is built from the GapArea values, not its capitalized keys');
	});

	test('rejects a gap missing any required field', () => {
		for (const field of ['area', 'gap', 'decision']) {
			const { gap } = setupGap({ [field]: undefined });

			const result = PlanGap.safeParse(gap);

			assert.equal(result.success, false, `${field} is required — area buckets the gap, gap states what is missing, and decision is the question put to the human`);
		}
	});

	test('rejects a non-string gap or decision rather than coercing it', () => {
		for (const overrides of [{ gap: 42 }, { decision: { question: 'which harness?' } }]) {
			const { gap } = setupGap(overrides);

			const result = PlanGap.safeParse(gap);

			assert.equal(result.success, false, 'gap and decision are the prose sentences the skill prints — neither is coerced from a number or a structured object');
		}
	});

	test('rejects a malformed options list', () => {
		for (const options of ['claude-code', [42], [{ label: 'claude-code' }]]) {
			const { gap } = setupGap({ options });

			const result = PlanGap.safeParse(gap);

			assert.equal(result.success, false, 'options is a list of the plain strings a human chooses among — a bare string is not a one-entry list, and a non-string entry is malformed');
		}
	});

	test('extra keys are stripped', () => {
		const { gap } = setupGap({ severity: 'high' });

		const parsed = PlanGap.parse(gap);

		assert.equal('severity' in parsed, false, 'a gap carries only the four declared fields, whatever else the agent happened to volunteer');
	});
});
