import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getVoiceMarkerPath } from '@/voice/common/paths/getVoiceMarkerPath';

interface Params {
	cwd: string;
}

/** Turn the read-out on for this project. The file's existence is the whole signal, so writing over one already there is harmless. */
export const createVoiceMarker = async ({ cwd }: Params): Promise<void> => {
	const markerPath = getVoiceMarkerPath({ cwd });

	await mkdir(dirname(markerPath), { recursive: true });
	await writeFile(markerPath, '', 'utf8');
};
