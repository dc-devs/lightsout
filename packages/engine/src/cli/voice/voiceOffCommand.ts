import { deleteVoiceMarker, stopSpeech } from '#src/voice/index.ts';

interface Params {
	cwd: string;
}

export const voiceOffCommand = async ({ cwd }: Params): Promise<void> => {
	await deleteVoiceMarker({ cwd });
	// Off has to mean silent now, not silent from the next question onwards.
	await stopSpeech({ cwd });

	console.log('voice off — questions will no longer be read aloud, and anything still playing was cut off');
};
