interface Params {
	ms?: number;
}

/**
 * Elapsed time with the minutes segment always present: `0m 00s`, `2m 40s`,
 * `70m 03s`. Minutes never roll into hours, matching `formatDuration`.
 *
 * Separate from `formatDuration` because that one drops the minutes under a
 * minute (`5s`), which breaks a fixed-width column — and it serves the
 * end-of-run report and several other readers that must not change with this
 * view.
 *
 * @returns The duration, or the em dash `—` when there is none to show.
 */
export const formatClockDuration = ({ ms }: Params): string => {
	if (ms === undefined) {
		return '—';
	}

	const seconds = Math.round(ms / 1000);

	return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};
