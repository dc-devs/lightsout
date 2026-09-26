import { join } from 'node:path';

interface Params {
	cwd: string;
}

/** The switch is a file so any process can read it, and it sits with the rest of a project's state: `<repo>/.lightsout/voice-on`. */
export const getVoiceMarkerPath = ({ cwd }: Params): string => {
	return join(cwd, '.lightsout', 'voice-on');
};
