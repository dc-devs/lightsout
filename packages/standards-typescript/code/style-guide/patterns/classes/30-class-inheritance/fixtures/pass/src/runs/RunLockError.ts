// The one licensed base: subclassing is the platform's only way to make a
// typed, instanceof-checkable error.
export class RunLockError extends Error {}

// Error-family chains stay licensed too.
export class StaleRunLockError extends RunLockError {}
