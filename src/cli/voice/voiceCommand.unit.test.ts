import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, describe, test, jest } from '@jest/globals';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { voiceCommand } from '@/cli/voice/voiceCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

// Mocked Imports
// -------------------------
// voiceCommand is a dispatcher: the only behaviour it owns is which subaction
// runs and what reaches it. Reading the real stdin is stubbed too — a Jest
// worker's stdin carries nothing and would simply hang the suite.

const mockVoiceOnCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockVoiceOffCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockVoiceHookCommand = jest.fn<(params: unknown) => Promise<void>>();
const mockGetStreamText = jest.fn<(params: unknown) => Promise<string>>();

// -------------------------

jest.mock('@/cli/voice/voiceOnCommand', () => ({ voiceOnCommand: (params: unknown) => mockVoiceOnCommand(params) }));
jest.mock('@/cli/voice/voiceOffCommand', () => ({ voiceOffCommand: (params: unknown) => mockVoiceOffCommand(params) }));
jest.mock('@/cli/voice/voiceHookCommand', () => ({ voiceHookCommand: (params: unknown) => mockVoiceHookCommand(params) }));
jest.mock('@/cli/voice/common/utils/getStreamText', () => ({ getStreamText: (params: unknown) => mockGetStreamText(params) }));

// stdin's own isTTY is not among the values tests/config/setupTestEnvironment.ts
// puts back, and a test that pinned it on would otherwise follow the suite into
// every file after it. Recorded at file scope so one hook restores it.
const realStdinIsTty = process.stdin.isTTY;

afterEach(() => {
	process.stdin.isTTY = realStdinIsTty;
});

const setupVoice = ({ args, inTerminal = false }: { args: string[]; inTerminal?: boolean }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-voice-command-'));

	mockVoiceOnCommand.mockResolvedValue(undefined);
	mockVoiceOffCommand.mockResolvedValue(undefined);
	mockVoiceHookCommand.mockResolvedValue(undefined);
	mockGetStreamText.mockResolvedValue('{"hook_event_name":"Stop"}');
	process.stdin.isTTY = inTerminal;

	return { context: { flags: parseFlags({ args }), rest: args, cwd }, cwd, ...captured };
};

describe('voiceCommand', () => {
	test('routes on to the switch, scoped to the project it was run in', async () => {
		const { context, cwd } = setupVoice({ args: ['on'] });

		await voiceCommand(context);

		expect(mockVoiceOnCommand).toHaveBeenCalledWith({ cwd });
	});

	test('routes off to the switch', async () => {
		const { context, cwd } = setupVoice({ args: ['off'] });

		await voiceCommand(context);

		expect(mockVoiceOffCommand).toHaveBeenCalledWith({ cwd });
	});

	test('routes hook with the payload the harness piped in', async () => {
		const { context, cwd } = setupVoice({ args: ['hook'] });

		await voiceCommand(context);

		expect(mockVoiceHookCommand).toHaveBeenCalledWith({ cwd, input: '{"hook_event_name":"Stop"}' });
	});

	test('run by hand in a terminal, hook is handed an empty payload rather than waiting forever', async () => {
		const { context, cwd } = setupVoice({ args: ['hook'], inTerminal: true });

		await voiceCommand(context);

		expect(mockVoiceHookCommand).toHaveBeenCalledWith({ cwd, input: '' });
		expect(mockGetStreamText).not.toHaveBeenCalled();
	});

	test('an unknown subaction prints the usage text and exits 1', async () => {
		const { context, errors, exitCodes } = setupVoice({ args: ['louder'] });

		await expect(voiceCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('no subaction at all is the same as an unknown one', async () => {
		const { context, exitCodes } = setupVoice({ args: [] });

		await expect(voiceCommand(context)).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([1]);
	});
});
