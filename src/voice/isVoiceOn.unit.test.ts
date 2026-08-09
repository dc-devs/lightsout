import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { isVoiceOn } from '@/voice';

const setupProject = ({ stateFolder = true, marker = false }: { stateFolder?: boolean; marker?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-is-voice-on-'));

	if (stateFolder) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
	}

	if (marker) {
		writeFileSync(join(cwd, '.lightsout', 'voice-on'), '');
	}

	return { cwd };
};

describe('isVoiceOn', () => {
	test('a project holding the marker reads as on', async () => {
		const { cwd } = setupProject({ marker: true });

		const on = await isVoiceOn({ cwd });

		expect(on).toBe(true);
	});

	test('a project with state but no marker reads as off', async () => {
		const { cwd } = setupProject();

		const on = await isVoiceOn({ cwd });

		expect(on).toBe(false);
	});

	test('a project with no state folder at all reads as off rather than failing', async () => {
		const { cwd } = setupProject({ stateFolder: false });

		const on = await isVoiceOn({ cwd });

		expect(on).toBe(false);
	});
});
