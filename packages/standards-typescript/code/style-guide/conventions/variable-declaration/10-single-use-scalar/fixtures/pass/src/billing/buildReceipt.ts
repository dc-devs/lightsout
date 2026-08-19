// Genuinely computed — it has a moving part (an identifier), so it is not a
// folded number, however many places read it.
const startedAt = Date.now();

// A folded number read in two places has earned its module scope.
const graceWindowMs = 5 * 60_000;

const isWithinGrace = ({ elapsedMs }: { elapsedMs: number }) => elapsedMs < graceWindowMs;

export const buildReceipt = ({ elapsedMs }: { elapsedMs: number }): string =>
	`started ${startedAt}, grace ${graceWindowMs}, within: ${isWithinGrace({ elapsedMs })}`;
