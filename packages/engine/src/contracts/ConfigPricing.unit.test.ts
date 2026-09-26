import { describe, expect, test } from '@jest/globals';
import { ConfigPricing } from '#src/contracts/ConfigPricing.ts';
import { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';

// Published rates for one model, written the way a user copies them from a
// harness vendor's price page: US dollars per million tokens, one rate per
// token count the activity record carries.
const setupRates = ({ input = 15, output = 75 }: { input?: number; output?: number } = {}) => ({
	input,
	output,
	'cache-read': 1.5,
	'cache-write': 18.75,
});

// The smallest config that parses, so an absent `pricing` block is the only
// thing the second half of the first case is measuring.
const setupConfigWithoutPricing = () => ({ gates: { check: 'c', test: 't', 'test-coverage': false } });

describe('ConfigPricing', () => {
	test('ConfigPricing: parses a model entry with all four per-million rates, and an absent block leaves the key undefined', () => {
		const rates = setupRates();
		const configWithoutPricing = setupConfigWithoutPricing();

		const parsed = ConfigPricing.parse({ 'claude-opus-5': rates });
		const parsedConfig = LightsoutConfig.parse(configWithoutPricing);

		expect(parsed).toStrictEqual({
			'claude-opus-5': { input: 15, output: 75, 'cache-read': 1.5, 'cache-write': 18.75 },
		});
		expect(parsedConfig.pricing).toBeUndefined();
		expect(Object.hasOwn(parsedConfig, 'pricing')).toBe(false);
	});

	test('ConfigPricing: refuses an unknown rate key and a negative rate instead of stripping them', () => {
		const misspelled = { ...setupRates(), cache_read: 1.5 };
		const negative = setupRates({ input: -1 });

		const unknownKey = ConfigPricing.safeParse({ 'claude-opus-5': misspelled });
		const negativeRate = ConfigPricing.safeParse({ 'claude-opus-5': negative });

		expect({
			unknownKeyAccepted: unknownKey.success,
			unknownKeyNamed: JSON.stringify(unknownKey.error?.issues ?? []).includes('cache_read'),
			negativeRateAccepted: negativeRate.success,
			negativeRateNamed: JSON.stringify(negativeRate.error?.issues ?? []).includes('input'),
		}).toStrictEqual({
			unknownKeyAccepted: false,
			unknownKeyNamed: true,
			negativeRateAccepted: false,
			negativeRateNamed: true,
		});
	});

	test('ConfigPricing: a model entry stating only some of the rates is refused, naming the rates it left out', () => {
		const halfCopied = { input: 15, output: 75 };

		const parsed = ConfigPricing.safeParse({ 'claude-opus-5': halfCopied });

		const issues = JSON.stringify(parsed.error?.issues ?? []);

		expect({
			accepted: parsed.success,
			cacheReadNamed: issues.includes('cache-read'),
			cacheWriteNamed: issues.includes('cache-write'),
		}).toStrictEqual({ accepted: false, cacheReadNamed: true, cacheWriteNamed: true });
	});

	test('ConfigPricing: a rate of zero is a stated price, and several models are priced in one block', () => {
		const free = { input: 0, output: 0, 'cache-read': 0, 'cache-write': 0 };

		const parsed = ConfigPricing.parse({ 'claude-opus-5': setupRates(), 'local-model': free });

		expect(parsed).toStrictEqual({
			'claude-opus-5': { input: 15, output: 75, 'cache-read': 1.5, 'cache-write': 18.75 },
			'local-model': { input: 0, output: 0, 'cache-read': 0, 'cache-write': 0 },
		});
	});

	test('ConfigPricing: a rate copied across as a string is refused rather than coerced to a number', () => {
		const quoted = { ...setupRates(), input: '15' };

		const parsed = ConfigPricing.safeParse({ 'claude-opus-5': quoted });

		expect(parsed.success).toBe(false);
	});
});
