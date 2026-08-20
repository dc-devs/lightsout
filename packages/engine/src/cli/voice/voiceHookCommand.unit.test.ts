import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { voiceHookCommand } from '#src/cli/voice/index.ts';

// Mocked Imports
// -------------------------
// Spawning `say` would make the test machine talk, and the reading is
// deliberately never waited on, so there would be nothing to synchronise
// against either. The marker, the transcript and the payload are all real.

const mockSpawn = jest.fn<(command: string, args: string[], options: object) => unknown>();

// -------------------------

jest.mock('node:child_process', () => ({
	spawn: (command: string, args: string[], options: object) => mockSpawn(command, args, options),
}));

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

const placementQuestion = [
	'**Context:** the switch has to live somewhere.',
	'',
	'**Question:** should it be per project?',
	'',
	'**Recommendation:** yes.',
].join('\n');

const assistantSaying = ({ text }: { text: string }) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } });

const userSaying = ({ text }: { text: string }) => JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text }] } });

const setupHook = ({
	platform = 'darwin',
	on = true,
	lines,
	payload,
	rawInput,
}: {
	platform?: string;
	on?: boolean;
	lines?: string[];
	payload?: Record<string, unknown>;
	rawInput?: string;
} = {}) => {
	pinPlatform({ platform });

	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-voice-hook-command-'));
	const transcriptPath = join(cwd, 'transcript.jsonl');
	const turn = lines ?? [userSaying({ text: 'plan it' }), assistantSaying({ text: placementQuestion })];

	mkdirSync(join(cwd, '.lightsout'), { recursive: true });
	writeFileSync(transcriptPath, `${turn.join('\n')}\n`);

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

	const input = rawInput ?? JSON.stringify({ hook_event_name: 'Stop', transcript_path: transcriptPath, cwd, ...payload });

	return { cwd, input, spoken };
};

describe('voiceHookCommand', () => {
	test('reads a finished turn that asked a labelled question aloud', async () => {
		const { cwd, input, spoken } = setupHook();

		await voiceHookCommand({ cwd, input });

		expect(mockSpawn).toHaveBeenCalledWith('say', [], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
		expect(spoken).toStrictEqual(['Context: the switch has to live somewhere.\n\nQuestion: should it be per project?\n\nRecommendation: yes.']);
	});

	test('reads an option picker the moment it appears, not the transcript behind it', async () => {
		const { cwd, input, spoken } = setupHook({
			payload: {
				hook_event_name: 'PreToolUse',
				tool_name: 'AskUserQuestion',
				tool_input: { questions: [{ question: 'Should it be per project?', options: [{ label: 'yes' }] }] },
			},
		});

		await voiceHookCommand({ cwd, input });

		// by the time the turn ends the picker is already answered, so speaking it
		// then would be both late and a repeat
		expect(spoken).toStrictEqual(['Should it be per project?\nOptions: yes']);
	});

	test('says nothing about a tool that is not the option picker', async () => {
		const { cwd, input } = setupHook({ payload: { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } } });

		await voiceHookCommand({ cwd, input });

		expect(mockSpawn).not.toHaveBeenCalled();
	});

	test('a project that never turned voice on stays silent', async () => {
		const { cwd, input } = setupHook({ on: false });

		await voiceHookCommand({ cwd, input });

		expect(mockSpawn).not.toHaveBeenCalled();
	});

	test('a turn that only reports progress is not read aloud', async () => {
		const { cwd, input } = setupHook({ lines: [userSaying({ text: 'plan it' }), assistantSaying({ text: 'Wrote the plan.' })] });

		await voiceHookCommand({ cwd, input });

		expect(mockSpawn).not.toHaveBeenCalled();
	});

	test.each([
		{ label: 'a payload that is not JSON', rawInput: 'not json at all' },
		{ label: 'a payload that is JSON but holds nothing', rawInput: 'null' },
	])('$label is dropped without a sound and without an error', async ({ rawInput }) => {
		const { cwd, input } = setupHook({ rawInput });

		await expect(voiceHookCommand({ cwd, input })).resolves.toBeUndefined();

		expect(mockSpawn).not.toHaveBeenCalled();
	});

	test('a finished turn with no transcript to read is dropped', async () => {
		const { cwd, input } = setupHook({ payload: { transcript_path: undefined } });

		await voiceHookCommand({ cwd, input });

		expect(mockSpawn).not.toHaveBeenCalled();
	});

	test('a payload that names no event is treated as the end of a turn', async () => {
		const { cwd, input, spoken } = setupHook({ payload: { hook_event_name: undefined } });

		await voiceHookCommand({ cwd, input });

		expect(spoken).toStrictEqual(['Context: the switch has to live somewhere.\n\nQuestion: should it be per project?\n\nRecommendation: yes.']);
	});

	test('a read-out that cannot even start is swallowed rather than surfaced in the session', async () => {
		const { cwd, input } = setupHook();

		mockSpawn.mockImplementation(() => {
			throw new Error('spawn say ENOENT');
		});

		await expect(voiceHookCommand({ cwd, input })).resolves.toBeUndefined();

		// the failure has to have happened on the way to the voice, not before it
		expect(mockSpawn).toHaveBeenCalledWith('say', [], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
	});

	test('a payload that names no project falls back to the folder the hook ran in', async () => {
		const { cwd, input } = setupHook({ payload: { cwd: undefined } });

		await voiceHookCommand({ cwd, input });

		expect(mockSpawn).toHaveBeenCalledWith('say', [], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
	});

	test('off a Mac there is no voice to read with, so nothing is spoken', async () => {
		const { cwd, input } = setupHook({ platform: 'linux' });

		await voiceHookCommand({ cwd, input });

		expect(mockSpawn).not.toHaveBeenCalled();
	});
});
