/**
 * How the shared gate reservation is waited for.
 *
 * One named object rather than three loose constants, because the three values
 * are one concept. They are fixed on purpose: no configuration key, so the
 * initial interface stays small.
 */
export const gateLockTimings = {
	/** The settled wait limit — 30 minutes, separate from each command's own execution timeout. */
	waitCeilingMs: 30 * 60_000,
	/** A gate run frees the machine at an unpredictable moment, and the next run should start promptly. */
	pollIntervalMs: 2_000,
	/** How often a waiting run says so. Fifteen polls happen between two lines, and the reader wants neither of the other rates. */
	progressIntervalMs: 30_000,
} as const;
