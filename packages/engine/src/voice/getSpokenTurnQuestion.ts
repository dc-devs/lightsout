import { getStringField } from '#src/voice/common/fields/getStringField.ts';
import { formatSpeakable } from '#src/voice/common/utils/formatSpeakable.ts';
import { isQuestionText } from '#src/voice/common/utils/isQuestionText.ts';

interface Params {
	/** The finished turn's message content blocks, as the harness reports them — shape untrusted. */
	blocks: unknown;
}

/**
 * The question a finished turn put to the user, ready to be read aloud — or
 * nothing, when the turn asked none.
 *
 * This is the pi-family half of what `getSpokenQuestion` reads out of a Claude
 * Code transcript: an omp or pi extension hands the engine the final turn's
 * message content directly, so there is no transcript to walk — the same
 * labelled-question rule decides what counts in both places.
 *
 * Never throws. This runs inside the pi-family extension's `voice speak`
 * invocation, where an error would surface in the user's own session.
 */
export const getSpokenTurnQuestion = ({ blocks }: Params): string | undefined => {
	if (!Array.isArray(blocks)) {
		return undefined;
	}

	const texts = blocks
		.map((block) => (getStringField({ value: block, key: 'type' }) === 'text' ? getStringField({ value: block, key: 'text' }) : undefined))
		.filter((text): text is string => text !== undefined && isQuestionText({ text }))
		.map((text) => formatSpeakable({ text }));

	return texts.length === 0 ? undefined : texts.join('\n\n');
};
