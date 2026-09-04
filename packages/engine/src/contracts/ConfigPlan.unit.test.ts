import { describe, expect, test } from '@jest/globals';
import { ConfigPlan } from '#src/contracts/index.ts';

describe('ConfigPlan', () => {
	test('accepts the block a repo actually writes, keeping the file’s own kebab-case spelling', () => {
		const parsed = ConfigPlan.parse({ contract: true, 'weight-thresholds': { 'created-files': 5, packages: 2 } });

		expect(parsed).toStrictEqual({ contract: true, 'weight-thresholds': { 'created-files': 5, packages: 2 } });
	});

	test('accepts an empty block, because every key has a documented default behind it', () => {
		expect(ConfigPlan.parse({})).toStrictEqual({});
	});

	test('refuses the switch as a string, rather than reading one as on', () => {
		expect(ConfigPlan.safeParse({ contract: 'yes' }).success).toBe(false);
	});

	test('refuses a fractional or negative created-files threshold — it counts whole files', () => {
		expect(ConfigPlan.safeParse({ 'weight-thresholds': { 'created-files': 2.5 } }).success).toBe(false);
		expect(ConfigPlan.safeParse({ 'weight-thresholds': { 'created-files': -1 } }).success).toBe(false);
	});

	test('refuses a packages threshold below one, which would make every plan file heavy', () => {
		expect(ConfigPlan.safeParse({ 'weight-thresholds': { packages: 0 } }).success).toBe(false);
	});

	test('refuses a key it does not know, at either level — a typo would silently leave the feature off', () => {
		expect(ConfigPlan.safeParse({ contracts: true }).success).toBe(false);
		expect(ConfigPlan.safeParse({ 'weight-thresholds': { 'created-file': 3 } }).success).toBe(false);
	});

	test('accepts each threshold at its own floor, so a repo may say every created file makes a plan file heavy', () => {
		const parsed = ConfigPlan.parse({ 'weight-thresholds': { 'created-files': 0, packages: 1 } });

		expect(parsed).toStrictEqual({ 'weight-thresholds': { 'created-files': 0, packages: 1 } });
	});

	test('accepts one threshold on its own, because the other keeps its documented default', () => {
		const parsed = ConfigPlan.parse({ contract: false, 'weight-thresholds': { packages: 3 } });

		expect(parsed).toStrictEqual({ contract: false, 'weight-thresholds': { packages: 3 } });
	});

	test('refuses a fractional packages threshold — it counts whole packages', () => {
		expect(ConfigPlan.safeParse({ 'weight-thresholds': { packages: 1.5 } }).success).toBe(false);
	});

	test('refuses thresholds written as anything but a block of counts', () => {
		expect(ConfigPlan.safeParse({ 'weight-thresholds': 3 }).success).toBe(false);
		expect(ConfigPlan.safeParse({ 'weight-thresholds': { 'created-files': '5' } }).success).toBe(false);
	});
});
