interface Params {
	text: string;
	/** 0-based character offset into `text`. */
	index: number;
}

/**
 * The 1-based line a character offset falls on.
 *
 * Every text-level check reports its spans from regex match offsets, so all of
 * them need this; counting newlines inline would be the same expression written
 * three slightly different ways.
 */
export const getLineNumber = ({ text, index }: Params): number => text.slice(0, index).split('\n').length;
