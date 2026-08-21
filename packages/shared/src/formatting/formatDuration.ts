interface Params {
	ms?: number;
}

/**
 * Elapsed time as a reader says it: `5s`, `1m 05s`, `61m 05s`. Minutes never
 * roll into hours, because the runs this measures are read in minutes and a
 * reader converting `1h 02m` back to minutes is doing the tool's job.
 *
 * @returns The duration, or the em dash `—` when there is no duration to show
 * — a step that never ran, not a step that took no time. Callers print it
 * straight into a table cell, so the placeholder belongs here rather than at
 * every call site.
 */
export const formatDuration = ({ ms }: Params): string => {
	if (ms === undefined) {
		return '—';
	}

	const seconds = Math.round(ms / 1000);

	return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};
