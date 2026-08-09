import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test, jest } from '@jest/globals';
import { voiceOffCommand } from '@/cli/voice/voiceOffCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

const setupVoiceOff = ({ on = true, playing }: { on?: boolean; playing?: string } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-voice-off-command-'));

	mkdirSync(join(cwd, '.lightsout'), { recursive: true });

	if (on) {
		writeFileSync(join(cwd, '.lightsout', 'voice-on'), '');
	}

	if (playing !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'voice-pid'), playing);
	}

	// The reading is a real process on a real Mac, so stopping one is the single
	// thing that cannot run for real here.
	const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);

	return { cwd, markerPath: join(cwd, '.lightsout', 'voice-on'), pidPath: join(cwd, '.lightsout', 'voice-pid'), kill, ...captured };
};

describe('voiceOffCommand', () => {
	test('turns the read-out off for this project and says so', async () => {
		const { cwd, markerPath, logged } = setupVoiceOff();

		await voiceOffCommand({ cwd });

		expect(existsSync(markerPath)).toBe(false);
		expect(logged[0] ?? '').toMatch(/voice off/);
	});

	test('cuts off a question already being read, so off means silent now', async () => {
		const { cwd, pidPath, kill } = setupVoiceOff({ playing: '777' });

		await voiceOffCommand({ cwd });

		expect(kill).toHaveBeenCalledWith(777);
		expect(existsSync(pidPath)).toBe(false);
	});

	test('turning it off when it was never on still confirms, rather than failing', async () => {
		const { cwd, logged } = setupVoiceOff({ on: false });

		await voiceOffCommand({ cwd });

		expect(logged[0] ?? '').toMatch(/voice off/);
	});
});
