import { expect, describe, test } from '@jest/globals';
import { getTestSubject } from './getTestSubject.ts';

describe('getTestSubject', () => {
	test('finds the source file a test sits beside', () => {
		const files = new Set(['src/common/utils/formatRate.ts', 'src/common/utils/formatRate.unit.test.ts']);

		expect(getTestSubject({ test: 'src/common/utils/formatRate.unit.test.ts', files })).toBe('src/common/utils/formatRate.ts');
	});

	test('finds a subject in any source dialect, so a JS-only repo is not read as misplaced tests', () => {
		for (const extension of ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']) {
			const files = new Set([`src/formatRate${extension}`]);

			expect(getTestSubject({ test: 'src/formatRate.unit.test.ts', files })).toBe(`src/formatRate${extension}`);
		}
	});

	test('finds nothing when the folder holds no such file — the co-location rule’s whole question', () => {
		const files = new Set(['src/common/utils/formatRate.unit.test.ts', 'src/elsewhere/formatRate.ts']);

		expect(getTestSubject({ test: 'src/common/utils/formatRate.unit.test.ts', files })).toBe(undefined);
	});

	test('looks only in the test’s own directory, never at a same-named file above it', () => {
		const files = new Set(['src/formatRate.ts', 'src/deep/formatRate.unit.test.ts']);

		expect(getTestSubject({ test: 'src/deep/formatRate.unit.test.ts', files })).toBe(undefined);
	});

	test('matches on the subject name, so a qualifier in the test filename does not hide it', () => {
		const files = new Set(['src/runPipeline.ts']);

		expect(getTestSubject({ test: 'src/runPipeline.monorepo.unit.test.ts', files })).toBe('src/runPipeline.ts');
	});
});
