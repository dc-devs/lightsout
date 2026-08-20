import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { getVoicePidPath } from '#src/voice/common/paths/getVoicePidPath.ts';
import { stopSpeech } from '#src/voice/stopSpeech.ts';

interface Params {
	cwd: string;
	text: string;
}

/**
 * Read the given text aloud through the Mac's own voice, and return without
 * waiting for it to finish.
 *
 * A newer question makes the one still playing stale, so the previous reading
 * is cut off rather than talked over. The text goes in on the child's input
 * stream instead of as an argument: that sidesteps command-line length limits
 * and stops a block beginning with a dash from being read as a flag. The child
 * is detached and unref'd so a long question does not hold the hook — and the
 * session — open while it plays.
 */
export const speakText = async ({ cwd, text }: Params): Promise<void> => {
	await stopSpeech({ cwd });

	const child = spawn('say', [], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });

	// A spawn failure with nobody listening is an uncaught exception, which for a
	// fire-and-forget hook means crashing the very session it serves.
	child.on('error', () => {});

	child.stdin?.write(text);
	child.stdin?.end();

	if (child.pid !== undefined) {
		await writeFile(getVoicePidPath({ cwd }), String(child.pid), 'utf8');
	}

	child.unref();
};
