// `applyTestDispositions`, `collectTestChanges`, `consultTestChangeReviewer`
// and `approvedTestPath` are deliberately not published: they are reached only
// from inside this module, and offering them would give a caller a way to
// approve a test file without the review that earns it.

export { approveTestFiles } from '#src/pipeline/approvedTests/approveTestFiles.ts';
export { readApprovedTest } from '#src/pipeline/approvedTests/readApprovedTest.ts';
export { removeApprovedTests } from '#src/pipeline/approvedTests/removeApprovedTests.ts';
export { reviewTestChanges } from '#src/pipeline/approvedTests/reviewTestChanges.ts';
