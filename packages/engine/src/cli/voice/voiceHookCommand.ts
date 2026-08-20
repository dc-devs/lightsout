import { getSpokenPickerText, getSpokenQuestion, isVoiceOn, speakText } from '#src/voice/index.ts';

interface Params {
	cwd: string;
	input: string;
}

const parseJson = ({ input }: { input: string }) => {
	try {
		const parsed: unknown = JSON.parse(input);

		return parsed;
	} catch {
		return undefined;
	}
};

const parseHookPayload = ({ input }: { input: string }) => {
	const payload = parseJson({ input });

	if (typeof payload !== 'object' || payload === null) {
		return undefined;
	}

	const hookEventName = 'hook_event_name' in payload ? payload.hook_event_name : undefined;
	const transcriptPath = 'transcript_path' in payload ? payload.transcript_path : undefined;
	const payloadCwd = 'cwd' in payload ? payload.cwd : undefined;
	const toolName = 'tool_name' in payload ? payload.tool_name : undefined;

	return {
		hookEventName: typeof hookEventName === 'string' ? hookEventName : undefined,
		transcriptPath: typeof transcriptPath === 'string' ? transcriptPath : undefined,
		payloadCwd: typeof payloadCwd === 'string' ? payloadCwd : undefined,
		toolName: typeof toolName === 'string' ? toolName : undefined,
		toolInput: 'tool_input' in payload ? payload.tool_input : undefined,
	};
};

const getSpokenText = async ({
	hookEventName,
	transcriptPath,
	toolName,
	toolInput,
}: {
	hookEventName: string | undefined;
	transcriptPath: string | undefined;
	toolName: string | undefined;
	toolInput: unknown;
}) => {
	if (hookEventName === 'PreToolUse') {
		return toolName === 'AskUserQuestion' ? getSpokenPickerText({ toolInput }) : undefined;
	}

	return transcriptPath === undefined ? undefined : getSpokenQuestion({ transcriptPath });
};

/**
 * The hook entry: decide whether this turn asked something, and if so read it
 * aloud.
 *
 * Every failure is swallowed and every path ends normally. A hook that exits
 * non-zero surfaces an error in the user's session, and a `PreToolUse` hook
 * that writes to stdout can block the tool it was only meant to narrate — so
 * being unhelpful is always preferable to being loud.
 */
export const voiceHookCommand = async ({ cwd, input }: Params): Promise<void> => {
	try {
		if (process.platform !== 'darwin') {
			return;
		}

		const payload = parseHookPayload({ input });

		if (payload === undefined) {
			return;
		}

		const projectCwd = payload.payloadCwd ?? cwd;

		if (!(await isVoiceOn({ cwd: projectCwd }))) {
			return;
		}

		const text = await getSpokenText(payload);

		if (text === undefined) {
			return;
		}

		await speakText({ cwd: projectCwd, text });
	} catch {
		// Silence is the contract: a broken read-out must never break the session.
	}
};
