import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { voiceSpeakCommand } from '#src/cli/voice/index.ts';

// Mocked Imports
// -------------------------
// Spawning `say` would make the test machine talk, and the reading is
// deliberately never waited on, so there would be nothing to synchronise
// against either. The marker and the payload are all real.

const mockSpawn = jest.fn<(command: string, args: string[], options: object) => unknown>();

// -------------------------

jest.mock('node:child_process', () => ({
	spawn: (command: string, args: string[], options: object) => mockSpawn(command, args, options),
}));

// The read-out is Mac-only, so a suite that took the machine's own platform
// would pass on a Mac and fail everywhere else. Recorded at file scope so one
// hook puts it back.
const realPlatform = process.platform;

const pinPlatform = ({ platform }: { platform: string }) => {
	Object.defineProperty(process, 'platform', { value: platform, writable: false, enumerable: true, configurable: true });
};

afterEach(() => {
	pinPlatform({ platform: realPlatform });
});

const placementQuestion = [
	'**Context:** the switch has to live somewhere.',
	'',
	'**Question:** should it be per project?',
	'',
	'**Recommendation:** yes.',
].join('\n');

const setupSpeak = ({ platform = 'darwin', on = true, payload }: { platform?: string; on?: boolean; payload?: string } = {}) => {
	pinPlatform({ platform });

	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-voice-speak-command-'));

	mkdirSync(join(cwd, '.lightsout'), { recursive: true });

	if (on) {
		writeFileSync(join(cwd, '.lightsout', 'voice-on'), '');
	}

	const spoken: string[] = [];

	mockSpawn.mockReturnValue({
		pid: 4242,
		stdin: {
			write: (text: string) => {
				spoken.push(text);
			},
			end: () => {},
		},
		on: () => {},
		unref: () => {},
	});

	return { cwd, input: payload ?? JSON.stringify([{ type: 'text', text: placementQuestion }]), spoken };
};

describe('voiceSpeakCommand', () => {
	test('reads a finished turn that asked a labelled question aloud, from the content blocks an extension pipes in', async () => {
		const { cwd, input, spoken } = setupSpeak();

		await voiceSpeakCommand({ cwd, kind: 'turn', input });

		expect(mockSpawn).toHaveBeenCalledWith('say', [], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
		expect(spoken).toStrictEqual(['Context: the switch has to live somewhere.\n\nQuestion: should it be per project?\n\nRecommendation: yes.']);
	});

	test('skips a finished turn that asked nothing — plain prose is not read aloud', async () => {
		const { cwd, input, spoken } = setupSpeak({ payload: JSON.stringify([{ type: 'text', text: 'All done. The plan is ready.' }]) });

		await voiceSpeakCommand({ cwd, kind: 'turn', input });

		expect(mockSpawn).not.toHaveBeenCalled();
		expect(spoken).toStrictEqual([]);
	});

	test('ignores non-text blocks — thinking and tool calls are not questions', async () => {
		const { cwd, input, spoken } = setupSpeak({
			payload: JSON.stringify([
				{ type: 'thinking', thinking: placementQuestion },
				{ type: 'toolCall', name: 'read' },
				{ type: 'text', text: placementQuestion },
			]),
		});

		await voiceSpeakCommand({ cwd, kind: 'turn', input });

		// the question is spoken once, from the text block alone
		expect(spoken).toHaveLength(1);
	});

	test('reads an option picker the moment it appears, from the ask tool input an extension pipes in', async () => {
		const { cwd, input, spoken } = setupSpeak({
			payload: JSON.stringify({
				questions: [{ question: 'Which database?', options: [{ label: 'postgres', description: 'boring and sturdy' }, { label: 'sqlite' }] }],
			}),
		});

		await voiceSpeakCommand({ cwd, kind: 'picker', input });

		expect(spoken).toStrictEqual(['Which database?\nOptions: postgres: boring and sturdy. sqlite']);
	});

	test('a picker holding no questions stays silent', async () => {
		const { cwd, spoken } = setupSpeak({ payload: '{}' });

		await voiceSpeakCommand({ cwd, kind: 'picker', input: '{}' });

		expect(spoken).toStrictEqual([]);
	});

	test('a payload that is not JSON stays silent rather than erroring into the session', async () => {
		const { cwd, spoken } = setupSpeak({ payload: 'not json' });

		await voiceSpeakCommand({ cwd, kind: 'turn', input: 'not json' });

		expect(spoken).toStrictEqual([]);
	});

	test('a turn payload that is not a content-block array stays silent', async () => {
		const { cwd, spoken } = setupSpeak({ payload: '{"message":"hello"}' });

		await voiceSpeakCommand({ cwd, kind: 'turn', input: '{"message":"hello"}' });

		expect(spoken).toStrictEqual([]);
	});

	test('a project that never turned voice on hears nothing', async () => {
		const { cwd, spoken } = setupSpeak({ on: false });

		await voiceSpeakCommand({ cwd, kind: 'turn', input: JSON.stringify([{ type: 'text', text: placementQuestion }]) });

		expect(spoken).toStrictEqual([]);
	});

	test('a non-Mac platform hears nothing', async () => {
		const { cwd, spoken } = setupSpeak({ platform: 'linux' });

		await voiceSpeakCommand({ cwd, kind: 'turn', input: JSON.stringify([{ type: 'text', text: placementQuestion }]) });

		expect(spoken).toStrictEqual([]);
	});
});
