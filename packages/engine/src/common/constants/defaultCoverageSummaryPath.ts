/**
 * Where coverage tooling writes its JSON summary when `coverage-summary-path` is
 * not configured — repo-relative in single-package repos, package-relative in
 * monorepo mode.
 *
 * Shared because three places must agree on it: the measurement that reads
 * per-file percentages, the batch check that excludes the measurement's own
 * output from a batch's changed files, and the doctor check that tells a
 * consumer the reporter is missing. A copy drifting would have the doctor bless
 * a path no run ever reads.
 */
export const defaultCoverageSummaryPath = 'coverage/coverage-summary.json';
