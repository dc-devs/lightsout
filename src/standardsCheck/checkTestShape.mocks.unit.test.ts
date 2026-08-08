import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { StandardsRule } from '@/contracts';
import { runStandardsCheck } from '@/standardsCheck';

/**
 * The mock half of the example repo, fixtures/.testShape/mocks. Same shape as
 * the structure suite: one case file per rule, so a rule's whole site-key list
 * pins both the violation and the files deliberately left alone.
 */
const setupMockCheck = async ({ rule }: { rule: StandardsRule }) => {
	const { findings } = await runStandardsCheck({ cwd: join(process.cwd(), 'fixtures/.testShape/mocks'), persist: false });

	return { matched: findings.filter((finding) => finding.rule === rule) };
};

describe('checkTestShape mock rules', () => {
	test('flags a module-scope mock without the prefix, and never a factory-local one', async () => {
		const { matched } = await setupMockCheck({ rule: 'test-mock-prefix' });

		// factoryLocalMock.unit.test.ts declares an unprefixed `getProfile` too —
		// inside a setup factory, where Jest's hoisting cannot reach it anyway
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-mock-prefix:unprefixedMock.unit.test.ts']);
		expect(matched[0]?.severity).toBe('finding');
		expect(matched[0]?.detail).toBe("'getProfile' (line 3) declared at module scope without a 'mock' prefix");
		expect(matched[0]?.files).toStrictEqual([{ path: 'unprefixedMock.unit.test.ts', startLine: 3, endLine: 3 }]);
	});

	test('flags a mock return value set in a beforeEach, never one set in a setup factory', async () => {
		const { matched } = await setupMockCheck({ rule: 'test-mock-return-in-hook' });

		// returnInFactory.unit.test.ts sets the same value where the doc puts it
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-mock-return-in-hook:returnInHook.unit.test.ts']);
		expect(matched[0]?.severity).toBe('finding');
		expect(matched[0]?.detail).toBe('beforeEach at line 6 sets a mock return value');
		expect(matched[0]?.files).toStrictEqual([{ path: 'returnInHook.unit.test.ts', startLine: 6, endLine: 8 }]);
	});

	test('flags a jest.fn() with no generic, and exempts one cast for a framework result', async () => {
		const { matched } = await setupMockCheck({ rule: 'test-mock-untyped' });

		// frameworkCastSpy.unit.test.ts keeps its `as unknown as` three lines below
		// the jest.fn() it wraps, which is why the statement carries the carve-out
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-mock-untyped:untypedSpy.unit.test.ts']);
		expect(matched[0]?.severity).toBe('finding');
		expect(matched[0]?.detail).toBe('jest.fn() with no generic at line(s) 3');
	});

	test('flags a factory wrapper that discards its arguments, on evidence or on type', async () => {
		const { matched } = await setupMockCheck({ rule: 'test-mock-wrapper-untyped' });

		// wrapperNoAssertion.unit.test.ts forwards zero arguments too — with no
		// toHaveBeenCalledWith in the file, nothing proves the function takes any
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual([
			'test-mock-wrapper-untyped:discardingWrapper.unit.test.ts',
			'test-mock-wrapper-untyped:wrapperUntyped.unit.test.ts',
		]);
		expect(matched.map((finding) => finding.detail)).toStrictEqual([
			'a `(...args: unknown[])` wrapper (line 5)',
			"'getProfile' forwards no arguments to mockGetProfile (line 5)",
		]);
		expect(matched[0]?.severity).toBe('finding');
	});

	test('flags manual cleanup in a hook, and never the same reset inside a setup factory', async () => {
		const { matched } = await setupMockCheck({ rule: 'test-manual-mock-cleanup' });

		// resetInFactory.unit.test.ts is the doc's own fallback for a package that
		// cannot adopt clearMocks — flagging it would punish its own advice
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-manual-mock-cleanup:manualCleanup.unit.test.ts']);
		expect(matched[0]?.severity).toBe('finding');
		expect(matched[0]?.detail).toBe('beforeEach at line 6 clears mocks by hand');
	});
});
