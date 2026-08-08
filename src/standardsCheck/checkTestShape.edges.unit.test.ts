import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { StandardsRule } from '@/contracts';
import { runStandardsCheck } from '@/standardsCheck';

/**
 * The third example repo, fixtures/.testShape/edges — the cases the per-rule
 * suites cannot show, because each of their files breaks exactly one rule once.
 * These files break one rule twice, break two rules at once, hide a brace inside
 * a string, name a test with `it` rather than `test`, or are not a test file at
 * all.
 */
const setupEdgeCheck = async ({ rule, file }: { rule?: StandardsRule; file?: string } = {}) => {
	const { findings } = await runStandardsCheck({ cwd: join(process.cwd(), 'fixtures/.testShape/edges'), persist: false });

	return {
		matched: findings.filter((finding) => (rule === undefined || finding.rule === rule) && (file === undefined || finding.files.some((site) => site.path === file))),
	};
};

describe('checkTestShape edge cases', () => {
	test('two violations of one rule in one file are one finding carrying both sites', async () => {
		const { matched } = await setupEdgeCheck({ rule: 'test-mock-prefix' });

		// readProfile.ts declares the same unprefixed mock and is not a test file —
		// this pass reads the test list, so a source file is never judged by it
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-mock-prefix:twoUnprefixedMocks.unit.test.ts']);
		expect(matched[0]?.detail).toBe("'getProfile' (line 3), 'getSettings' (line 5) declared at module scope without a 'mock' prefix");
		// both declarations ride on the one finding, so the work-list row stays one file to open
		expect(matched[0]?.files).toStrictEqual([
			{ path: 'twoUnprefixedMocks.unit.test.ts', startLine: 3, endLine: 3 },
			{ path: 'twoUnprefixedMocks.unit.test.ts', startLine: 5, endLine: 5 },
		]);
	});

	test('a brace inside a string or a comment never ends a hook body early', async () => {
		const { matched } = await setupEdgeCheck({ rule: 'test-mock-return-in-hook' });

		// the hook sets its return value below a string holding `}` and a comment
		// holding another — brace matching that counted them would stop reading at
		// line 8 and report nothing at all
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-mock-return-in-hook:bracesInStrings.unit.test.ts']);
		expect(matched[0]?.detail).toBe('beforeEach at line 6 sets a mock return value');
		// and the span still closes on the hook's real last line
		expect(matched[0]?.files).toStrictEqual([{ path: 'bracesInStrings.unit.test.ts', startLine: 6, endLine: 11 }]);
	});

	test('a test named with `it` is read as a test, not skipped', async () => {
		const { matched } = await setupEdgeCheck({ rule: 'test-multiple-setups' });

		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-multiple-setups:itMultipleSetups.unit.test.ts']);
		expect(matched[0]?.severity).toBe('advisory');
		expect(matched[0]?.detail).toBe("'reads both arrangements' (line 8) calls more than one setup factory");
	});

	test('a file breaking two rules gets one finding for each, keyed apart', async () => {
		const { matched } = await setupEdgeCheck({ file: 'twoRules.unit.test.ts' });

		// the mock and structure helpers concatenate — a file is never collapsed
		// into a single row that hides one of its violations
		expect(matched.map((finding) => finding.siteKey)).toStrictEqual(['test-assert-in-hook:twoRules.unit.test.ts', 'test-nested-describe:twoRules.unit.test.ts']);
		expect(matched.map((finding) => finding.detail)).toStrictEqual([
			'beforeEach at line 5 asserts',
			"'the details of the thing' (line 4) nested inside another describe",
		]);
	});
});
