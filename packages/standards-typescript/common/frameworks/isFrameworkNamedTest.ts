import type { FrameworkCarveOut } from '../types/FrameworkCarveOut.ts';
import { isUnderRouterRoot } from './isUnderRouterRoot.ts';

interface Params {
	/** Repo-relative path of a test file. */
	test: string;
	/** The carve-out of the package that governs this test. */
	carveOut: FrameworkCarveOut;
}

/**
 * Whether the framework owns the dots in a test file's name, so its subject is
 * the stem minus the test suffix rather than the first segment:
 * `runs.$runId.unit.test.tsx` names `runs.$runId`, not `runs`.
 *
 * Router roots only, and entry files deliberately excluded: an entry file's name
 * (`main.ts`, `router.tsx`) carries no dots beyond the extension, so a test
 * beside it already resolves correctly through the ordinary first-segment rule.
 * This dimension exists for the names a framework fills with dots.
 */
export const isFrameworkNamedTest = ({ test, carveOut }: Params): boolean => isUnderRouterRoot({ path: test, carveOut });
