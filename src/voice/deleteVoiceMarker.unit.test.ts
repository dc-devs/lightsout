import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { deleteVoiceMarker } from '@/voice';

const setupProject = ({
	marker = true,
	otherState = false,
}: { marker?: boolean; otherState?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-delete-voice-marker-'));
	const markerPath = join(cwd, '.lightsout', 'voice-on');
	const otherStatePath = join(cwd, '.lightsout', 'runs');

	if (marker) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(markerPath, '');
	}

	if (otherState) {
		mkdirSync(otherStatePath, { recursive: true });
	}

	return { cwd, markerPath, otherStatePath };
};

describe('deleteVoiceMarker', () => {
	test('removes the marker, so the hook reads voice as off', async () => {
		const { cwd, markerPath } = setupProject();

		await deleteVoiceMarker({ cwd });

		expect(existsSync(markerPath)).toBe(false);
	});

	test('turning voice off in a project that never turned it on is not an error', async () => {
		const { cwd, markerPath } = setupProject({ marker: false });

		await expect(deleteVoiceMarker({ cwd })).resolves.toBeUndefined();

		expect(existsSync(markerPath)).toBe(false);
	});

	test('removes only the marker, leaving the rest of the project state untouched', async () => {
		const { cwd, otherStatePath } = setupProject({ otherState: true });

		await deleteVoiceMarker({ cwd });

		expect(existsSync(otherStatePath)).toBe(true);
	});
});
