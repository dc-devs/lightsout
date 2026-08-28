import { describe, expect, test } from '@jest/globals';
import { ConfigAutoPlan } from '#src/contracts/index.ts';

describe('ConfigAutoPlan', () => {
	test('accepts the block a repo actually writes, keeping the file’s own kebab-case spelling', () => {
		const parsed = ConfigAutoPlan.parse({ 'propose-before-draft': true, 'implement-on-approval': true, 'auto-approve-plan': false });

		expect(parsed).toStrictEqual({
			'propose-before-draft': true,
			'implement-on-approval': true,
			'auto-approve-plan': false,
		});
	});

	test('accepts an empty block, because every key has a documented default behind it', () => {
		const parsed = ConfigAutoPlan.parse({});

		expect(parsed).toStrictEqual({});
	});

	test('refuses a checkpoint switch that is not a boolean, rather than reading a string as on', () => {
		const parsed = ConfigAutoPlan.safeParse({ 'auto-approve-plan': 'yes' });

		expect(parsed.success).toBe(false);
	});

	test('refuses a key it does not know — a typo here would silently disable a setting the file believes is on', () => {
		const parsed = ConfigAutoPlan.safeParse({ 'auto-aprove': true });

		expect(parsed.success).toBe(false);
	});

	test('refuses the removed `auto-approve` spelling with a message naming the key that replaced it, so a stale config is told what to write', () => {
		const parsed = ConfigAutoPlan.safeParse({ 'auto-approve': true });

		expect(parsed.success).toBe(false);
		expect(parsed.error?.issues[0]?.message).toContain('auto-plan.auto-approve-plan');
	});
});
