import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { StandardsRule } from '@/contracts';
import { runStandardsCheck } from '@/standardsCheck';

/**
 * The example repo is fixtures/.testShape/structure — real files rather than
 * strings, because this pass READS test files and a bad example typed into this
 * one would be a genuine violation of it. The dot in `.testShape` is what keeps
 * a whole-repo run from walking in; a run rooted at the folder itself walks it
 * normally.
 *
 * Every case file violates exactly one rule, so pinning a rule's whole site-key
 * list also pins the files that were deliberately left alone.
 */
const setupShapeCheck = async ({ rule }: { rule: StandardsRule }) => {
	const { findings } = await runStandardsCheck({ cwd: join(process.cwd(), 'fixtures/.testShape/structure'), persist: false });

	return { matched: findings.filter((finding) => finding.rule === rule) };
};

describe('checkTestShape structure rules', () => {
	test('flags a `let` a beforeEach reassigns, and leaves a hook-free one alone', async () => {
		const { matched } = await setupShapeCheck({ rule: 'test-shared-let' });

		// localLet.unit.test.ts declares a module `let` too — but no hook assigns it
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-shared-let:sharedLet.unit.test.ts']);
		// mutable test state is a rule violation, not a judgment call
		expect(matched[0]?.severity).toBe('blocking');
		expect(matched[0]?.detail).toBe("'subject' (line 3) reassigned in a beforeEach");
		// the site is the declaration, so an edit below it keeps the same identity
		expect(matched[0]?.files).toStrictEqual([{ path: 'sharedLet.unit.test.ts', startLine: 3, endLine: 3 }]);
	});

	test('flags an assertion in a beforeEach, and never one in an afterEach', async () => {
		const { matched } = await setupShapeCheck({ rule: 'test-assert-in-hook' });

		// an `expect` in an afterEach is an ordinary leak check the doc never bans
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-assert-in-hook:assertInHook.unit.test.ts']);
		expect(matched[0]?.severity).toBe('blocking');
		expect(matched[0]?.detail).toBe('beforeEach at line 4 asserts');
		// the site spans the whole hook, which is the block to move the act out of
		expect(matched[0]?.files).toStrictEqual([{ path: 'assertInHook.unit.test.ts', startLine: 4, endLine: 6 }]);
	});

	test('flags a nested describe unless its title opens with `when` or `for`', async () => {
		const { matched } = await setupShapeCheck({ rule: 'test-nested-describe' });

		// nestedDescribeWhen.unit.test.ts nests twice — both inside the exception
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-nested-describe:nestedDescribe.unit.test.ts']);
		expect(matched[0]?.severity).toBe('blocking');
		expect(matched[0]?.detail).toBe("'the details of the thing' (line 4) nested inside another describe");
	});

	test('flags toStrictEqual with an asymmetric matcher, never with a concrete object', async () => {
		const { matched } = await setupShapeCheck({ rule: 'test-strict-equal-matcher' });

		// a whole-object assertion is exactly what the doc reserves toStrictEqual for
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-strict-equal-matcher:strictEqualMatcher.unit.test.ts']);
		expect(matched[0]?.severity).toBe('blocking');
		expect(matched[0]?.detail).toBe('toStrictEqual with an asymmetric matcher at line(s) 7');
	});

	test('reports a second setup call in one test as a judgment call, not a violation', async () => {
		const { matched } = await setupShapeCheck({ rule: 'test-multiple-setups' });

		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-multiple-setups:multipleSetups.unit.test.ts']);
		// a helper named setupSomething may legitimately be called by another factory
		expect(matched[0]?.severity).toBe('advisory');
		expect(matched[0]?.detail).toBe("'reads both arrangements' (line 8) calls more than one setup factory");
		expect(matched[0]?.guidance).toBe('Two setups means two tests. Heuristic — judge before acting.');
	});

	test('reports a setup factory over the parameter cap, and lets one sitting at it pass', async () => {
		const { matched } = await setupShapeCheck({ rule: 'test-mega-factory' });

		// leanFactory.unit.test.ts declares exactly six — the cap is strictly greater
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-mega-factory:megaFactory.unit.test.ts']);
		expect(matched[0]?.severity).toBe('advisory');
		expect(matched[0]?.detail).toBe("'setupReport' takes 7 parameters (line 3), over the cap of 6");
	});
});
