import { rm } from 'node:fs/promises';
import { getVoiceMarkerPath } from '#src/voice/common/paths/getVoiceMarkerPath.ts';

interface Params {
	cwd: string;
}

/** Turn the read-out off for this project. Turning off what was never on is a no-op, never an error. */
export const deleteVoiceMarker = async ({ cwd }: Params): Promise<void> => {
	await rm(getVoiceMarkerPath({ cwd }), { force: true });
};
