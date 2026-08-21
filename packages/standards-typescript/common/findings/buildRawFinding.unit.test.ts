import { describe, expect, test } from '@jest/globals';
import { buildRawFinding } from './buildRawFinding.ts';

/** What a check hands the builder: the rule that found it, the sites, and what it says about them. */
const setupFinding = ({
	rule = 'test-assert-in-hook',
	files = [{ path: 'src/alpha.unit.test.ts', startLine: 3, endLine: 5 }],
	detail = 'beforeEach at line 3 asserts',
	guidance = 'Act and assert live in the `test`; a hook only arranges.',
}: {
	rule?: string;
	files?: Array<{ path: string; startLine?: number; endLine?: number }>;
	detail?: string;
	guidance?: string;
} = {}) => ({ rule, files, detail, guidance });

describe('buildRawFinding', () => {
	test('keys the finding by its rule and the file it reports, and carries the rest through untouched', () => {
		const { rule, files, detail, guidance } = setupFinding();

		const finding = buildRawFinding({ rule, files, detail, guidance });

		expect(finding).toStrictEqual({
			siteKey: 'test-assert-in-hook:src/alpha.unit.test.ts',
			files: [{ path: 'src/alpha.unit.test.ts', startLine: 3, endLine: 5 }],
			detail: 'beforeEach at line 3 asserts',
			guidance: 'Act and assert live in the `test`; a hook only arranges.',
		});
	});

	test('a file violating twice enters the key once and keeps both of its sites', () => {
		const { rule, detail, guidance } = setupFinding();
		const files = [
			{ path: 'src/alpha.unit.test.ts', startLine: 3, endLine: 5 },
			{ path: 'src/alpha.unit.test.ts', startLine: 11, endLine: 13 },
		];

		const finding = buildRawFinding({ rule, files, detail, guidance });

		expect(finding).toStrictEqual({
			siteKey: 'test-assert-in-hook:src/alpha.unit.test.ts',
			files: [
				{ path: 'src/alpha.unit.test.ts', startLine: 3, endLine: 5 },
				{ path: 'src/alpha.unit.test.ts', startLine: 11, endLine: 13 },
			],
			detail: 'beforeEach at line 3 asserts',
			guidance: 'Act and assert live in the `test`; a hook only arranges.',
		});
	});

	test('several files sort into the key whatever order they were reported in', () => {
		const { rule, detail, guidance } = setupFinding();
		const files = [{ path: 'src/beta.unit.test.ts' }, { path: 'src/alpha.unit.test.ts' }];

		const finding = buildRawFinding({ rule, files, detail, guidance });

		expect(finding.siteKey).toBe('test-assert-in-hook:src/alpha.unit.test.ts|src/beta.unit.test.ts');
		expect(finding.files).toStrictEqual([{ path: 'src/beta.unit.test.ts' }, { path: 'src/alpha.unit.test.ts' }]);
	});

	test('a finding reporting no file at all is keyed by its rule alone', () => {
		const { rule, detail, guidance } = setupFinding();

		const finding = buildRawFinding({ rule, files: [], detail, guidance });

		expect(finding.siteKey).toBe('test-assert-in-hook:');
	});
});
