interface Params {
	count: number;
}

/** The plural `s` a count needs, or nothing when it needs none: `${rounds} round${plural({ count: rounds })}`. */
export const plural = ({ count }: Params): string => (count === 1 ? '' : 's');
