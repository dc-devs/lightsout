const maxRetries = 10;

// A folded number names a value the same way a bare literal does.
const retryWindowMs = 10 * 60_000;

export const chargeInvoice = ({ attempt, elapsedMs }: { attempt: number; elapsedMs: number }): boolean => attempt < maxRetries && elapsedMs < retryWindowMs;
