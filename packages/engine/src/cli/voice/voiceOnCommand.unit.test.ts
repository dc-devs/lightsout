import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { voiceOnCommand } from '@/cli/voice';

// The read-out is Mac-only, so a suite that took the machine's own platform
// would pass on a Mac and fail everywhere else. jest.replaceProperty cannot pin
// it — platform is a non-writable property, which replaceProperty assigns to
// rather than redefines. Recorded at file scope so one hook puts it back.
const realPlatform = process.platform;

const pinPlatform = ({ platform }: { platform: string }) => {
	Object.defineProperty(process, 'platform', { value: platform, writable: false, enumerable: true, configurable: true });
};

afterEach(() => {
	pinPlatform({ platform: realPlatform });
});

const setupVoiceOn = ({ platform = 'darwin' }: { platform?: string } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-voice-on-command-'));

	pinPlatform({ platform });

	return { cwd, markerPath: join(cwd, '.lightsout', 'voice-on'), ...captured };
};

describe('voiceOnCommand', () => {
	test('turns the read-out on for this project and says so', async () => {
		const { cwd, markerPath, logged } = setupVoiceOn();

		await voiceOnCommand({ cwd });

		expect(existsSync(markerPath)).toBe(true);
		expect(logged[0] ?? '').toMatch(/voice on/);
	});

	test('off a Mac it still flips the switch, but says nothing will be spoken', async () => {
		const { cwd, markerPath, logged } = setupVoiceOn({ platform: 'linux' });

		await voiceOnCommand({ cwd });

		// otherwise it "succeeds" here and then stays silent with no explanation
		expect(existsSync(markerPath)).toBe(true);
		expect(logged.join('\n')).toMatch(/nothing will be spoken/);
	});

	test('on a Mac it does not warn about a platform the user is already on', async () => {
		const { cwd, logged } = setupVoiceOn();

		await voiceOnCommand({ cwd });

		expect(logged.join('\n')).not.toMatch(/nothing will be spoken/);
	});
});
