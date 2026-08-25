import { describe, expect, test } from '@jest/globals';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getTestSubjectName } from './getTestSubjectName.ts';

/** A package whose framework owns every name inside `src/routes/`. */
const routerCarveOut: FrameworkCarveOut = {
	directory: '.',
	entryFiles: [],
	exemptFolderNames: [],
	kebabCase: false,
	moduleFolders: [],
	routerRoots: ['routes'],
};

describe('getTestSubjectName', () => {
	test('names the subject a test sits beside — everything before the first dot', () => {
		expect(getTestSubjectName({ test: 'src/common/utils/formatRate.unit.test.ts' })).toBe('formatRate');
	});

	test('drops a qualifier as readily as the suffix, since both follow the first dot', () => {
		expect(getTestSubjectName({ test: 'src/pipeline/runPipeline.monorepo.unit.test.ts' })).toBe('runPipeline');
	});

	test('reads the filename alone, not the folders above it', () => {
		expect(getTestSubjectName({ test: 'src/a.b.c/formatRate.spec.tsx' })).toBe('formatRate');
	});

	test('a name with no dot at all is the whole filename', () => {
		expect(getTestSubjectName({ test: 'src/common/utils/formatRate' })).toBe('formatRate');
	});

	test('under a router root the framework owns the dots, so only the test suffix is stripped', () => {
		expect(getTestSubjectName({ test: 'src/routes/runs.$runId.unit.test.tsx', carveOut: routerCarveOut })).toBe('runs.$runId');
	});

	test('the same name with no carve-out given keeps the first-dot answer, which is what leaves today’s callers unchanged', () => {
		expect(getTestSubjectName({ test: 'src/routes/runs.$runId.unit.test.tsx' })).toBe('runs');
	});

	test.each([
		{ marker: 'integration', base: 'runs.$runId.integration.test.tsx' },
		{ marker: 'e2e', base: 'runs.$runId.e2e.test.tsx' },
		{ marker: 'test', base: 'runs.$runId.test.tsx' },
		{ marker: 'spec', base: 'runs.$runId.spec.tsx' },
	])('the $marker segment closes a route name too — the suffix set is what the dots are read against', ({ base }) => {
		const subjectName = getTestSubjectName({ test: `src/routes/${base}`, carveOut: routerCarveOut });

		expect(subjectName).toBe('runs.$runId');
	});

	test('a router-root name carrying no suffix segment at all drops the extension alone', () => {
		expect(getTestSubjectName({ test: 'src/routes/runs.$runId.tsx', carveOut: routerCarveOut })).toBe('runs.$runId');
	});

	test('a router-root name whose first segment is itself a suffix marker keeps that segment rather than naming nothing', () => {
		expect(getTestSubjectName({ test: 'src/routes/unit.test.tsx', carveOut: routerCarveOut })).toBe('unit');
	});

	test('a carve-out given for a file outside the router root leaves the first-dot answer alone', () => {
		expect(getTestSubjectName({ test: 'src/common/utils/formatRate.unit.test.ts', carveOut: routerCarveOut })).toBe('formatRate');
	});
});
