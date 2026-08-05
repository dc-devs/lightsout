interface Params {
	ms?: number;
}

export const formatDuration = ({ ms }: Params): string => {
	if (ms === undefined) {
		return '—';
	}

	const seconds = Math.round(ms / 1000);

	return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};
