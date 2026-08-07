import { expect, describe, test } from '@jest/globals';
import { AgentUsage } from '@/contracts';

/** Every field a different number, so a mix-up between two of them shows. */
const setupUsage = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const usage: Record<string, unknown> = {
		inputTokens: 10,
		outputTokens: 100,
		cacheReadTokens: 880,
		cacheCreationTokens: 110,
		costUsd: 0.5,
		...extra,
	};

	if (omit) {
		delete usage[omit];
	}

	return { usage };
};

describe('AgentUsage', () => {
	test('parses a complete envelope, keeping every counter on its own field', () => {
		const { usage } = setupUsage();

		const parsed = AgentUsage.parse(usage);

		expect(parsed).toStrictEqual({
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
		});
	});

	test('every field is required — an envelope missing any one of the five fails', () => {
		for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens', 'costUsd']) {
			const { usage } = setupUsage({ omit: field });

			// a partial envelope is refused whole rather than recorded with ${field}
			// silently zeroed — the engine records what it can prove and never estimates
			expect(AgentUsage.safeParse(usage).success).toBe(false);
		}
	});

	test('a numeric string is refused rather than coerced', () => {
		const { usage } = setupUsage({ extra: { inputTokens: '10' } });

		// a harness reporting a string count is a driver bug, not a value to silently
		// convert
		expect(AgentUsage.safeParse(usage).success).toBe(false);
	});

	test('extra keys a harness envelope carries are stripped from the normalized record', () => {
		const { usage } = setupUsage({ extra: { serviceTier: 'standard', webSearchRequests: 3 } });

		const parsed = AgentUsage.parse(usage);

		// the schema normalizes to the fields the engine records — harness-specific
		// extras never reach the ledger
		expect('serviceTier' in parsed).toBe(false);
		expect('webSearchRequests' in parsed).toBe(false);
	});

	test('zero counters and a fractional cost parse — a free, cache-only invocation is a real reading', () => {
		const { usage } = setupUsage({
			extra: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.000125 },
		});

		const parsed = AgentUsage.parse(usage);

		// zero is a reported reading, distinct from an omitted field
		expect(parsed.inputTokens).toBe(0);
		// cost keeps its fractional precision — it is summed across every invocation
		// of a run
		expect(parsed.costUsd).toBe(0.000125);
	});
});
