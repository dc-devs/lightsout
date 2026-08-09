import { join } from 'node:path';

interface Params {
	cwd: string;
}

/** Where the reading currently playing records itself, so a newer question can cut it off: `<repo>/.lightsout/voice-pid`. */
export const getVoicePidPath = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'voice-pid');
};
