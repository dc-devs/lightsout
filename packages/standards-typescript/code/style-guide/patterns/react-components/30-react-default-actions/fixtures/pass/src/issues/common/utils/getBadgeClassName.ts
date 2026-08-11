interface Params {
	state: string;
	compact: boolean;
}

export const getBadgeClassName = ({ state, compact }: Params): string =>
	['badge', state === 'open' ? 'badge-open' : 'badge-closed', compact ? 'badge-compact' : ''].filter((part) => part.length > 0).join(' ');
