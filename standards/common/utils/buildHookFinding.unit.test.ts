import { expect, describe, test } from '@jest/globals';
import type { CallBlock } from '../types/CallBlock.ts';
import { buildHookFinding } from './buildHookFinding.ts';

/** One hook call as `readCallBlocks` reports it — a hook never carries a title, and these sit at file scope. */
const hookBlock = ({ callee, body, startLine, endLine }: { callee: string; body: string; startLine: number; endLine: number }): CallBlock => ({
	callee,
	title: '',
	body,
	startLine,
	endLine,
	depth: 0,
});

/** The hook blocks a rule handed over, plus the words it wants said about the ones that match. */
const setupHookFinding = ({ blocks = [] }: { blocks?: CallBlock[] } = {}) => ({
	rule: 'test-assert-in-hook',
	file: 'src/alpha.unit.test.ts',
	blocks,
	pattern: /\bexpect\s*\(/,
	detailSuffix: 'asserts',
	guidance: 'Act and assert live in the `test`; a hook only arranges.',
});

describe('buildHookFinding', () => {
	test('a hook whose body matches becomes one finding naming the hook, its line, and its span', () => {
		const params = setupHookFinding({ blocks: [hookBlock({ callee: 'beforeEach', body: 'expect(sum).toBe(2);', startLine: 4, endLine: 6 })] });

		const findings = buildHookFinding(params);

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-assert-in-hook:src/alpha.unit.test.ts',
				files: [{ path: 'src/alpha.unit.test.ts', startLine: 4, endLine: 6 }],
				detail: 'beforeEach at line 4 asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			},
		]);
	});

	test('no hook body matching the pattern leaves the file with nothing to report', () => {
		const params = setupHookFinding({ blocks: [hookBlock({ callee: 'beforeEach', body: 'const sum = 1 + 1;', startLine: 4, endLine: 6 })] });

		const findings = buildHookFinding(params);

		expect(findings).toStrictEqual([]);
	});

	test('several matching hooks report as one finding listing every one of them', () => {
		const params = setupHookFinding({
			blocks: [
				hookBlock({ callee: 'beforeEach', body: 'expect(sum).toBe(2);', startLine: 4, endLine: 6 }),
				hookBlock({ callee: 'afterEach', body: 'expect(store.size).toBe(0);', startLine: 12, endLine: 14 }),
			],
		});

		const findings = buildHookFinding(params);

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-assert-in-hook:src/alpha.unit.test.ts',
				files: [
					{ path: 'src/alpha.unit.test.ts', startLine: 4, endLine: 6 },
					{ path: 'src/alpha.unit.test.ts', startLine: 12, endLine: 14 },
				],
				detail: 'beforeEach at line 4, afterEach at line 12 asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			},
		]);
	});

	test('a hook that does not match is left out of both the sites and the detail', () => {
		const params = setupHookFinding({
			blocks: [
				hookBlock({ callee: 'beforeEach', body: 'const sum = 1 + 1;', startLine: 4, endLine: 6 }),
				hookBlock({ callee: 'beforeEach', body: 'expect(sum).toBe(2);', startLine: 12, endLine: 14 }),
			],
		});

		const findings = buildHookFinding(params);

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-assert-in-hook:src/alpha.unit.test.ts',
				files: [{ path: 'src/alpha.unit.test.ts', startLine: 12, endLine: 14 }],
				detail: 'beforeEach at line 12 asserts',
				guidance: 'Act and assert live in the `test`; a hook only arranges.',
			},
		]);
	});
});
