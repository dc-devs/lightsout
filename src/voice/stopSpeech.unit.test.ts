import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { stopSpeech } from '@/voice';

// The reading itself is a real process on a real Mac, so the one thing that
// cannot run for real here is the kill — everything around it is a real file in
// a temp project.
const setupPlaying = ({ recorded, killFails = false }: { recorded?: string; killFails?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-stop-speech-'));
	const pidPath = join(cwd, '.lightsout', 'voice-pid');

	mkdirSync(join(cwd, '.lightsout'), { recursive: true });

	if (recorded !== undefined) {
		writeFileSync(pidPath, recorded);
	}

	const kill = jest.spyOn(process, 'kill').mockImplementation(() => {
		if (killFails) {
			throw new Error('no such process');
		}

		return true;
	});

	return { cwd, pidPath, kill };
};

describe('stopSpeech', () => {
	test('cuts off the reading still playing and forgets it', async () => {
		const { cwd, pidPath, kill } = setupPlaying({ recorded: '4321' });

		await stopSpeech({ cwd });

		expect(kill).toHaveBeenCalledWith(4321);
		expect(existsSync(pidPath)).toBe(false);
	});

	test('with nothing playing there is nothing to cut off', async () => {
		const { cwd, kill } = setupPlaying();

		await stopSpeech({ cwd });

		expect(kill).not.toHaveBeenCalled();
	});

	test('a record that is not a process id stops nothing, and is cleared away', async () => {
		const { cwd, pidPath, kill } = setupPlaying({ recorded: 'not-a-process' });

		await stopSpeech({ cwd });

		expect(kill).not.toHaveBeenCalled();
		expect(existsSync(pidPath)).toBe(false);
	});

	// 0 and -1 are not readings — to the operating system they mean "every process
	// in the group" and "every process this user owns". A stale record holding one
	// must stop nothing at all.
	test.each([{ recorded: '0' }, { recorded: '-1' }])('a record of $recorded stops nothing, and is cleared away', async ({ recorded }) => {
		const { cwd, pidPath, kill } = setupPlaying({ recorded });

		await stopSpeech({ cwd });

		expect(kill).not.toHaveBeenCalled();
		expect(existsSync(pidPath)).toBe(false);
	});

	test('a reading that already finished on its own is not an error', async () => {
		const { cwd, pidPath } = setupPlaying({ recorded: '4321', killFails: true });

		await expect(stopSpeech({ cwd })).resolves.toBeUndefined();

		expect(existsSync(pidPath)).toBe(false);
	});
});
