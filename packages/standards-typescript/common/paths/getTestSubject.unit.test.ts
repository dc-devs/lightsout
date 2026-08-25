import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getTestSubject } from './getTestSubject.ts';

/** A package whose framework owns every name inside `src/routes/`. */
const routerCarveOut: FrameworkCarveOut = {
	directory: '.',
	entryFiles: [],
	exemptFolderNames: [],
	kebabCase: false,
	moduleFolders: [],
	routerRoots: ['routes'],
};

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

	test('finds the route file a co-located route test sits beside, dots and all', () => {
		const files = new Set(['src/routes/runs.$runId.tsx', 'src/routes/runs.$runId.unit.test.tsx']);

		expect(getTestSubject({ test: 'src/routes/runs.$runId.unit.test.tsx', files, carveOut: routerCarveOut })).toBe('src/routes/runs.$runId.tsx');
	});

	test('without the carve-out the same test names `runs`, which no file answers to — the friction this fixes', () => {
		const files = new Set(['src/routes/runs.$runId.tsx', 'src/routes/runs.$runId.unit.test.tsx']);

		expect(getTestSubject({ test: 'src/routes/runs.$runId.unit.test.tsx', files })).toBe(undefined);
	});

	test('finds the route index a co-located test sits beside, since only the suffix is stripped', () => {
		const files = new Set(['src/routes/index.tsx', 'src/routes/index.unit.test.tsx']);

		expect(getTestSubject({ test: 'src/routes/index.unit.test.tsx', files, carveOut: routerCarveOut })).toBe('src/routes/index.tsx');
	});

	test('a carve-out given for a test outside the router root still finds its first-dot subject', () => {
		const files = new Set(['src/common/utils/formatRate.ts']);

		expect(getTestSubject({ test: 'src/common/utils/formatRate.unit.test.ts', files, carveOut: routerCarveOut })).toBe('src/common/utils/formatRate.ts');
	});
});
