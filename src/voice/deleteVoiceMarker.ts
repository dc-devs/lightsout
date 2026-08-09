import { rm } from 'node:fs/promises';
import { getVoiceMarkerPath } from '@/voice/common/paths/getVoiceMarkerPath';

interface Params {
	cwd: string;
}

/** Turn the read-out off for this project. Turning off what was never on is a no-op, never an error. */
export const deleteVoiceMarker = async ({ cwd }: Params): Promise<void> => {
	await rm(getVoiceMarkerPath({ cwd }), { force: true });
};
