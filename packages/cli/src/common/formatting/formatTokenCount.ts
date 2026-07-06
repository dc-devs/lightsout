interface Params {
	count: number;
}

export const formatTokenCount = ({ count }: Params): string => {
	if (count >= 1_000_000) {
		return `${(count / 1_000_000).toFixed(1)}M`;
	}

	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
};
