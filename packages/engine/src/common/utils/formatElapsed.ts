interface Params {
	elapsedMs: number;
}

/**
 * Elapsed wall time as a reader says it: `45s`, `1m30s`, `12m05s`.
 */
export const formatElapsed = ({ elapsedMs }: Params): string => {
	const totalSeconds = Math.round(elapsedMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	return minutes === 0 ? `${seconds}s` : `${minutes}m${String(seconds).padStart(2, '0')}s`;
};
