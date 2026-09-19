import type { getPlanDetectionPass } from '#src/plan/common/utils/getPlanDetectionPass.ts';

/**
 * What a read-only detection pass — dedup or grade — is handed once its
 * workspace exists: the plan files, the overview text, the config and the
 * workspace directory.
 *
 * Derived from the resolver rather than restated, so the shape cannot drift from
 * what that function actually returns.
 */
export type DetectionPass = Awaited<ReturnType<typeof getPlanDetectionPass>>;
