import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AgentUsage, RunUsage } from '@/contracts';

const setupTotals = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const totals: Record<string, unknown> = {
		invocations: 7,
		inputTokens: 10,
		outputTokens: 100,
		cacheReadTokens: 880,
		cacheCreationTokens: 110,
		costUsd: 0.5,
		...extra,
	};

	if (omit) {
		delete totals[omit];
	}

	return { totals };
};

describe('RunUsage', () => {
	test('parses the run-wide aggregate — every AgentUsage counter plus the invocation count', () => {
		const { totals } = setupTotals();

		const parsed = RunUsage.parse(totals);

		assert.deepEqual(parsed, {
			invocations: 7,
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
		});
	});

	test('invocations is required — a one-invocation envelope is not a run aggregate', () => {
		const { totals } = setupTotals({ omit: 'invocations' });

		assert.equal(RunUsage.safeParse(totals).success, false, 'the aggregate is only meaningful alongside the count it was summed from');
		assert.equal(AgentUsage.safeParse(totals).success, true, 'the same object is still a valid single-invocation envelope — the extra field is what separates the two contracts');
	});

	test('the inherited counters stay required — dropping one fails the aggregate too', () => {
		const { totals } = setupTotals({ omit: 'cacheReadTokens' });

		assert.equal(RunUsage.safeParse(totals).success, false, 'extending AgentUsage adds a field, it does not relax the ones it inherits');
	});

	test('a non-number invocation count is refused rather than coerced', () => {
		const { totals } = setupTotals({ extra: { invocations: '7' } });

		assert.equal(RunUsage.safeParse(totals).success, false, 'the count is arithmetic the run keeps adding to — a string would concatenate');
	});

	test('a zeroed aggregate parses — a run that has invoked nothing yet still has totals', () => {
		const { totals } = setupTotals({
			extra: { invocations: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
		});

		const parsed = RunUsage.parse(totals);

		assert.equal(parsed.invocations, 0, 'a fresh run seeds its totals at zero rather than omitting them');
	});
});
