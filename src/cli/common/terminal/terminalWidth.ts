const narrowest = 60;
const widest = 120;

/**
 * Columns to lay text out in.
 *
 * Clamped at both ends: a terminal narrower than the floor would wrap file
 * paths into confetti, and one wider than the ceiling produces lines too long
 * for an eye to track back to the next. Piped output reports no width at all,
 * so it takes a readable fixed default.
 */
export const terminalWidth = (): number => Math.min(Math.max(process.stdout.columns ?? 100, narrowest), widest);
