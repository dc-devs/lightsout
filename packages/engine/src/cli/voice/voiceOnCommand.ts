import { createVoiceMarker } from '#src/voice/index.ts';

interface Params {
	cwd: string;
}

export const voiceOnCommand = async ({ cwd }: Params): Promise<void> => {
	await createVoiceMarker({ cwd });

	console.log('voice on — turns that ask a lightsout question will be read aloud (marker: .lightsout/voice-on)');

	// Without this, turning voice on somewhere else "succeeds" and then never
	// makes a sound, with nothing said about why.
	if (process.platform !== 'darwin') {
		console.log('note: the read-out uses the Mac\'s own "say" voice, so nothing will be spoken on this machine');
	}
};
