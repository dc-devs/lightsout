import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { createVoiceMarker } from '@/voice';

const setupProject = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-create-voice-marker-'));

	return { cwd, markerPath: join(cwd, '.lightsout', 'voice-on') };
};

describe('createVoiceMarker', () => {
	test('writes the marker into a project that has no state folder yet', async () => {
		const { cwd, markerPath } = setupProject();

		await createVoiceMarker({ cwd });

		expect(existsSync(markerPath)).toBe(true);
	});

	test('writes the marker empty, since its existence is the whole signal', async () => {
		const { cwd, markerPath } = setupProject();

		await createVoiceMarker({ cwd });

		expect(readFileSync(markerPath, 'utf8')).toBe('');
	});

	test('turning voice on when it is already on leaves it on', async () => {
		const { cwd, markerPath } = setupProject();
		await createVoiceMarker({ cwd });

		await createVoiceMarker({ cwd });

		expect(existsSync(markerPath)).toBe(true);
		expect(readFileSync(markerPath, 'utf8')).toBe('');
	});
});
