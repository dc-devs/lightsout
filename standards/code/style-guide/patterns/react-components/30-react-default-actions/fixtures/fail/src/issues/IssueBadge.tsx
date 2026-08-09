interface Props {
	state: string;
	compact: boolean;
}

// The same className expression and the same inline style, written again at
// every usage — the default action is to extract them once.
export const IssueBadge = ({ state, compact }: Props) => (
	<span
		className={`badge ${state === 'open' ? 'badge-open' : 'badge-closed'} ${compact ? 'badge-compact' : ''}`}
		style={{ paddingLeft: compact ? 2 : 8, paddingRight: compact ? 2 : 8 }}
	>
		{state}
	</span>
);
