interface Params {
	text: string;
}

/** The labels both interview skills mandate: the question label plus at least one of the parts that make a one-word answer safe. */
export const isQuestionText = ({ text }: Params): boolean => {
	const supportingLabels = ['**Context:**', '**Options:**', '**Recommendation:**'];

	return text.includes('**Question:**') && supportingLabels.some((label) => text.includes(label));
};
