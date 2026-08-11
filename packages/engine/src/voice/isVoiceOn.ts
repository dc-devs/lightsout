import { access } from 'node:fs/promises';
import { getVoiceMarkerPath } from '@/voice/common/paths/getVoiceMarkerPath';

interface Params {
	cwd: string;
}

/** Whether this project asked for its questions to be read aloud. Anything that is not a readable marker reads as off. */
export const isVoiceOn = async ({ cwd }: Params): Promise<boolean> => {
	return access(getVoiceMarkerPath({ cwd }))
		.then(() => true)
		.catch(() => false);
};
