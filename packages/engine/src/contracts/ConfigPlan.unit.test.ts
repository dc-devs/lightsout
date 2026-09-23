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

	test('accepts the planning-worktree switch and still refuses a misspelled plan key', () => {
		const switchedOff = ConfigPlan.parse({ worktree: false });
		const unsaid = ConfigPlan.parse({ contract: true });
		const misspelled = ConfigPlan.safeParse({ worktrees: false });

		expect(switchedOff).toStrictEqual({ worktree: false });
		expect(unsaid).toStrictEqual({ contract: true });
		expect(Object.hasOwn(unsaid, 'worktree')).toBe(false);
		expect(misspelled.success).toBe(false);
	});

	test('refuses the planning-worktree switch as a string, rather than reading "false" as on', () => {
		expect(ConfigPlan.safeParse({ worktree: 'false' }).success).toBe(false);
	});

	test('accepts either work order mode as the repository default and adds no key when unsaid', () => {
		const single = ConfigPlan.parse({ 'default-work-order-mode': 'single-plan' });
		const multiple = ConfigPlan.parse({ 'default-work-order-mode': 'multiple-plan' });
		const unsaid = ConfigPlan.parse({ contract: true });

		expect(single).toStrictEqual({ 'default-work-order-mode': 'single-plan' });
		expect(multiple).toStrictEqual({ 'default-work-order-mode': 'multiple-plan' });
		expect(Object.hasOwn(unsaid, 'default-work-order-mode')).toBe(false);
	});

	test('refuses a default work order mode outside the two modes and its camelCase spelling', () => {
		const outsideTheModes = ConfigPlan.safeParse({ 'default-work-order-mode': 'multiple' });
		const camelCase = ConfigPlan.safeParse({ defaultWorkOrderMode: 'single-plan' });

		expect(outsideTheModes.success).toBe(false);
		expect(camelCase.success).toBe(false);
	});

	test('ConfigPlan: accepts default-work-order-mode and refuses the old default-ticket-mode key', () => {
		const single = ConfigPlan.parse({ 'default-work-order-mode': 'single-plan' });
		const multiple = ConfigPlan.parse({ 'default-work-order-mode': 'multiple-plan' });
		const oldKey = ConfigPlan.safeParse({ 'default-ticket-mode': 'single-plan' });

		expect(single).toStrictEqual({ 'default-work-order-mode': 'single-plan' });
		expect(multiple).toStrictEqual({ 'default-work-order-mode': 'multiple-plan' });
		expect(oldKey.success).toBe(false);
	});
});
