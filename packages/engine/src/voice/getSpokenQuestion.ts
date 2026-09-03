import { readFile } from 'node:fs/promises';
import { getArrayField } from '#src/voice/common/fields/getArrayField.ts';
import { getField } from '#src/voice/common/fields/getField.ts';
import { getStringField } from '#src/voice/common/fields/getStringField.ts';
import { formatSpeakable } from '#src/voice/common/utils/formatSpeakable.ts';
import { isQuestionText } from '#src/voice/common/utils/isQuestionText.ts';

interface Params {
	transcriptPath: string;
}

const parseEntry = ({ line }: { line: string }) => {
	try {
		const parsed: unknown = JSON.parse(line);

		return parsed;
	} catch {
		return undefined;
	}
};

const getContentBlocks = ({ entry }: { entry: unknown }) => {
	return getArrayField({ value: getField({ value: entry, key: 'message' }), key: 'content' });
};

const getBlockText = ({ block }: { block: unknown }) => {
	return getStringField({ value: block, key: 'type' }) === 'text' ? getStringField({ value: block, key: 'text' }) : undefined;
};

/**
 * A `user` entry carrying only tool results is the harness feeding the model,
 * not the person typing — treating it as the start of the turn would cut the
 * turn in half at every tool call.
 */
const isRealUserMessage = ({ entry }: { entry: unknown }) => {
	const typed = getStringField({ value: getField({ value: entry, key: 'message' }), key: 'content' }) !== undefined;

	return typed || getContentBlocks({ entry }).some((block) => getBlockText({ block }) !== undefined);
};

const getFinalTurnEntries = ({ lines }: { lines: string[] }) => {
	const entries: unknown[] = [];

	for (const line of [...lines].reverse()) {
		const entry = parseEntry({ line });
		const type = getStringField({ value: entry, key: 'type' });

		if (type === undefined || getField({ value: entry, key: 'isSidechain' }) === true) {
			continue;
		}

		if (type === 'assistant') {
			entries.push(entry);
		} else if (type === 'user' && isRealUserMessage({ entry })) {
			break;
		}
	}

	return entries.reverse();
};
const getQuestionTexts = ({ entries }: { entries: unknown[] }) => {
	const texts: string[] = [];

	for (const entry of entries) {
		for (const block of getContentBlocks({ entry })) {
			const text = getBlockText({ block });

			if (text !== undefined && isQuestionText({ text })) {
				texts.push(text);
			}
		}
	}

	return texts;
};

/**
 * The question the finished turn put to the user, ready to be read aloud — or
 * nothing, when the turn asked none.
 *
 * Only the final turn counts: everything before it was already answered. Tool
 * calls are ignored here, because the option picker is spoken the moment it
 * appears rather than after it has been answered.
 *
 * Never throws. This runs inside a hook, where an error would surface as a
 * failure in the user's own session.
 */
export const getSpokenQuestion = async ({ transcriptPath }: Params): Promise<string | undefined> => {
	const raw = await readFile(transcriptPath, 'utf8').catch(() => undefined);

	if (raw === undefined) {
		return undefined;
	}

	const lines = raw.split('\n').filter((line) => line.trim() !== '');
	const texts = getQuestionTexts({ entries: getFinalTurnEntries({ lines }) }).map((text) => formatSpeakable({ text }));

	return texts.length === 0 ? undefined : texts.join('\n\n');
};
