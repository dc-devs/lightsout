import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RunUsage } from '@/contracts';
import { seedUsageTotals } from '@/runState';

/** A manifest's persisted spend — every field a different number so a mix-up shows. */
const setupPersistedUsage = (): { usage: RunUsage } => ({
	usage: {
		invocations: 3,
		inputTokens: 10,
		outputTokens: 100,
		cacheReadTokens: 880,
		cacheCreationTokens: 110,
		costUsd: 0.5,
	},
});

describe('seedUsageTotals', () => {
	test('starts a fresh run at zero on every field', () => {
		const totals = seedUsageTotals({});

		assert.deepEqual(totals, {
			invocations: 0,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheCreationTokens: 0,
			costUsd: 0,
		});
	});

	test('carries the manifest totals forward when a run resumes', () => {
		const { usage } = setupPersistedUsage();

		const totals = seedUsageTotals({ usage });

		assert.deepEqual(totals, {
			invocations: 3,
			inputTokens: 10,
			outputTokens: 100,
			cacheReadTokens: 880,
			cacheCreationTokens: 110,
			costUsd: 0.5,
		});
	});

	test('returns an aggregate the run can add to without writing back through the manifest', () => {
		const { usage } = setupPersistedUsage();

		const totals = seedUsageTotals({ usage });

		totals.invocations += 1;
		assert.equal(usage.invocations, 3, 'the live aggregate is accumulated in place — sharing it would corrupt the loaded manifest');
	});
});
