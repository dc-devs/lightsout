interface Params {
	text: string;
}

/**
 * Strip the decoration a voice cannot say.
 *
 * Bold markers, backticks and heading hashes are punctuation for the eye — read
 * aloud they are either noise or silence, and the blank-line runs they leave
 * behind become long dead pauses mid-question.
 */
export const formatSpeakable = ({ text }: Params): string => {
	return text
		.replace(/\*\*/g, '')
		.replace(/`/g, '')
		.replace(/^#{1,6}\s*/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
};
