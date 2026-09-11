interface Params {
	text: string;
}

/**
 * The words of one finding that could plausibly identify the defect it
 * describes, reduced to the form two wordings of the same defect share: lower
 * case, split on everything that is not a letter or a digit, and nothing shorter
 * than six characters.
 *
 * The length floor is what removes the grading vocabulary every finding carries
 * — `plan`, `phase`, `file`, `gap`, `agent` — without a hand-kept stop list that
 * would have to follow every brief. There is no stemming and no synonym table on
 * purpose: shared words are a hint for which findings a judge sees together,
 * never proof they are one defect, and a hint that batches too eagerly costs a
 * larger prompt and nothing else.
 */
export const distinctiveWords = ({ text }: Params): Set<string> => {
	const minimumLength = 6;

	return new Set(
		text
			.toLowerCase()
			.split(/[^\p{L}\p{N}]+/u)
			.filter((word) => word.length >= minimumLength),
	);
};
