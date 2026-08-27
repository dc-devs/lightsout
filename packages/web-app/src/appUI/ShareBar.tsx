interface Props {
	/** This row's own count. */
	value: number;
	/** The largest count in the set the row belongs to — what the bar is a share of. */
	max: number;
}

/**
 * One row's count drawn as a share of the largest count beside it.
 *
 * The bar carries no label and no number: it sits under a row that already
 * states both, and its whole job is to make "one of these holds most of it"
 * visible without reading. That is why it is hidden from assistive technology —
 * a screen reader has already been told the count.
 *
 * A caller renders this only when it has rows, so `max` is never zero.
 */
export const ShareBar = ({ value, max }: Props) => (
	<span aria-hidden="true" className="block h-1.5 rounded-full bg-muted">
		{/* The width is a share of the largest bar, so it can only be a computed style. */}
		<span className="block h-1.5 rounded-full bg-status-failed" style={{ width: `${(value / max) * 100}%` }} />
	</span>
);
