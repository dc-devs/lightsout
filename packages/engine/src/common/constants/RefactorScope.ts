/**
 * Which caller a refactor executor is working for.
 *
 * The two differ in WHAT THEY MAY WRITE, never in what they may change: a
 * refactor that alters behavior is a failure of either. A feature's refactor
 * step rides on a branch someone will review as a feature, so a reorganization
 * spreading out of it is not what that reviewer agreed to read. The standalone
 * command has no such branch and no such promise — reorganizing is the whole
 * reason it was invoked.
 */
export const RefactorScope = {
	/** The refactor step inside an implement run: the feature's own changed files, nothing else. */
	Feature: 'feature',
	/** The `lightsout refactor` command: the standards findings are the work-list, and moving code between files is the point. */
	Standalone: 'standalone',
} as const;

export type RefactorScope = (typeof RefactorScope)[keyof typeof RefactorScope];
