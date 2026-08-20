import { getArrayField } from '#src/voice/common/fields/getArrayField.ts';
import { getStringField } from '#src/voice/common/fields/getStringField.ts';
import { formatSpeakable } from '#src/voice/common/utils/formatSpeakable.ts';

interface Params {
	toolInput: unknown;
}

const getOptionLine = ({ option }: { option: unknown }) => {
	const label = getStringField({ value: option, key: 'label' });
	const description = getStringField({ value: option, key: 'description' });

	if (label === undefined || label === '') {
		return undefined;
	}

	return description === undefined || description === '' ? label : `${label}: ${description}`;
};

const getQuestionBlock = ({ question }: { question: unknown }) => {
	const text = getStringField({ value: question, key: 'question' });
	const optionLines = getArrayField({ value: question, key: 'options' })
		.map((option) => getOptionLine({ option }))
		.filter((line) => line !== undefined);
	const parts = [text === '' ? undefined : text, optionLines.length === 0 ? undefined : `Options: ${optionLines.join('. ')}`];

	return parts.filter((part) => part !== undefined).join('\n');
};

/**
 * What an option picker is asking, ready to be read aloud — or nothing, when
 * the tool input holds no questions.
 *
 * The picker is spoken as it appears rather than from the finished transcript:
 * by the time a turn ends the user has already answered it, so reading it then
 * would be both late and a repeat.
 */
export const getSpokenPickerText = ({ toolInput }: Params): string | undefined => {
	const blocks = getArrayField({ value: toolInput, key: 'questions' })
		.map((question) => getQuestionBlock({ question }))
		.filter((block) => block !== '');

	return blocks.length === 0 ? undefined : formatSpeakable({ text: blocks.join('\n\n') });
};
