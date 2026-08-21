import { describe, expect, test } from '@jest/globals';
import { joinPath } from './joinPath.ts';

describe('joinPath', () => {
	test.each([
		{ from: 'src/billing', specifier: './formatRate', expected: 'src/billing/formatRate' },
		{ from: 'src/billing', specifier: '../common/formatRate', expected: 'src/common/formatRate' },
		{ from: 'src/billing', specifier: 'formatRate', expected: 'src/billing/formatRate' },
		{ from: 'packages/engine', specifier: './src/agents', expected: 'packages/engine/src/agents' },
	])('joins $from + $specifier into $expected', ({ from, specifier, expected }) => {
		const joined = joinPath({ from, specifier });

		expect(joined).toBe(expected);
	});

	test('anchors to the repo root when the folder is a bare dot', () => {
		const joined = joinPath({ from: '.', specifier: './src/app' });

		expect(joined).toBe('src/app');
	});

	test('walks past the root rather than throwing, since a specifier may be written wrong', () => {
		// the callers treat an escaped path as naming nothing in scope, which is the
		// same answer they give any path the run never listed
		const joined = joinPath({ from: 'src', specifier: '../../outside' });

		expect(joined).toBe('outside');
	});
});
