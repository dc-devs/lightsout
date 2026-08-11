import { describe, expect, test } from '@jest/globals';
import { isUnderSrc } from './isUnderSrc.ts';

describe('isUnderSrc', () => {
	test('a file whose folder sits under a src segment is under src', () => {
		expect(isUnderSrc({ path: 'src/common/utils/formatRate.ts' })).toBe(true);
		expect(isUnderSrc({ path: 'packages/api/src/handlers/get.ts' })).toBe(true);
	});

	test('a file outside src is not, which is what makes tests/ and fixtures/ sanctioned there', () => {
		expect(isUnderSrc({ path: 'tests/helpers/report.ts' })).toBe(false);
		expect(isUnderSrc({ path: 'fixtures/pass/thing.ts' })).toBe(false);
	});

	test('the segment must be whole — a folder merely starting with src is not it', () => {
		expect(isUnderSrc({ path: 'srcarchive/utils/formatRate.ts' })).toBe(false);
		expect(isUnderSrc({ path: 'my-src/utils/formatRate.ts' })).toBe(false);
	});

	test('a file sitting directly in src counts, since its own folder is the segment', () => {
		expect(isUnderSrc({ path: 'src/app.ts' })).toBe(true);
	});

	test('a file at the repo root is not under src', () => {
		expect(isUnderSrc({ path: 'index.ts' })).toBe(false);
	});
});
