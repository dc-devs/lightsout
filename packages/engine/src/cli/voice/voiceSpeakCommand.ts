import { getSpokenPickerText, getSpokenTurnQuestion, isVoiceOn, speakText } from '#src/voice/index.ts';

/** Which pi-family event the payload describes. */
export type VoiceSpeakKind = 'turn' | 'picker';

interface Params {
	cwd: string;
	kind: VoiceSpeakKind;
	/** The event payload as JSON: the ask tool's input for `picker`, the final message's content blocks for `turn`. */
	input: string;
}

/**
 * The pi-family half of the voice hook: an omp or pi extension pipes an event
 * payload in, and this decides whether it asked something worth reading aloud
 * and, if so, reads it.
 *
 * Same contract as `voice hook` — every failure is swallowed and every path
 * ends normally, because an extension-side error surfaces in the user's own
 * session, and being unhelpful is always preferable to being loud.
 */
export const voiceSpeakCommand = async ({ cwd, kind, input }: Params): Promise<void> => {
	try {
		if (process.platform !== 'darwin') {
			return;
		}

		if (!(await isVoiceOn({ cwd }))) {
			return;
		}

		let payload: unknown;

		try {
			payload = JSON.parse(input);
		} catch {
			return;
		}

		const text = kind === 'picker' ? getSpokenPickerText({ toolInput: payload }) : getSpokenTurnQuestion({ blocks: payload });

		if (text === undefined) {
			return;
		}

		await speakText({ cwd, text });
	} catch {
		// Silence is the contract: a broken read-out must never break the session.
	}
};
