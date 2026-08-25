import { isUnderRouterRoot } from '../frameworks/isUnderRouterRoot.ts';
import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { getBaseName } from './getBaseName.ts';

/**
 * The segments that open a test filename's suffix — the kind markers this
 * repo's own names use, and the two markers `isTestFile` reads. A closed set
 * is the point: under a router root the dots before it are route segments, so
 * only a named suffix may be stripped.
 */
const testSuffixSegments = new Set(['unit', 'integration', 'e2e', 'test', 'spec']);

const getRouterSubjectName = ({ base }: { base: string }) => {
	const segments = base.split('.');
	const end = segments.findIndex((segment) => testSuffixSegments.has(segment));

	return segments.slice(0, end === -1 ? -1 : Math.max(end, 1)).join('.');
};

interface Params {
	/** Repo-relative path of a test file. */
	test: string;
	/** The carve-out of the package that governs this test, when the caller knows it — under a router root the framework owns the whole filename. */
	carveOut?: FrameworkCarveOut;
}

/**
 * A test file's first name segment — the name of the subject it must sit
 * beside.
 *
 * Everything from the first dot on is qualifier and suffix
 * (`runPipeline.monorepo.unit.test.ts` names `runPipeline`), so the subject is
 * what precedes it.
 *
 * Under a file router's directory the framework owns every dot in the name, so
 * the subject is the stem minus the test suffix instead:
 * `runs.$runId.unit.test.tsx` names `runs.$runId`, not `runs`.
 */
export const getTestSubjectName = ({ test, carveOut }: Params): string => {
	const base = getBaseName({ path: test });

	return carveOut !== undefined && isUnderRouterRoot({ path: test, carveOut }) ? getRouterSubjectName({ base }) : base.replace(/\..*$/, '');
};
