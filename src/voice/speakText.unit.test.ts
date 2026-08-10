import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { speakText } from '@/voice';

// Mocked Imports
// -------------------------
// The one thing that cannot run for real: spawning `say` would make the test
// machine talk, and the child is deliberately never waited on, so there would
// be nothing to synchronise against either. Everything else — the pid file, the
// project folder — is real.

const mockSpawn = jest.fn<(command: string, args: string[], options: object) => unknown>();

// -------------------------

jest.mock('node:child_process', () => ({
	spawn: (command: string, args: string[], options: object) => mockSpawn(command, args, options),
}));

const setupSpeech = ({ pid = 4242, recorded, withInputStream = true }: { pid?: number; recorded?: string; withInputStream?: boolean } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-speak-text-'));
	const pidPath = join(cwd, '.lightsout', 'voice-pid');

	mkdirSync(join(cwd, '.lightsout'), { recursive: true });

	if (recorded !== undefined) {
		writeFileSync(pidPath, recorded);
	}

	const spoken: string[] = [];
	const inputStream = {
		write: (text: string) => {
			spoken.push(text);
		},
		end: jest.fn<() => void>(),
	};
	const child: {
		pid: number | undefined;
		stdin: typeof inputStream | null;
		on: jest.Mock<(event: string, listener: () => void) => void>;
		unref: jest.Mock<() => void>;
	} = {
		pid,
		stdin: withInputStream ? inputStream : null,
		on: jest.fn<(event: string, listener: () => void) => void>(),
		unref: jest.fn<() => void>(),
	};

	mockSpawn.mockReturnValue(child);

	const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);

	return { cwd, pidPath, child, inputStream, spoken, kill };
};

describe('speakText', () => {
	test("hands the block to the Mac's own voice on the child's input stream, and lets go of it", async () => {
		const { cwd, spoken, child, inputStream } = setupSpeech();

		await speakText({ cwd, text: '- Question: should it ship?' });

		expect(mockSpawn).toHaveBeenCalledWith('say', [], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
		// no text argument and nothing waited on: a block opening with a dash would
		// otherwise be read as a flag, and a long question would hold the hook open
		expect(spoken).toStrictEqual(['- Question: should it ship?']);
		// the stream is closed as well as written to: `say` reads to the end of its
		// input before it starts, so a stream left open is a question never read
		expect(inputStream.end).toHaveBeenCalled();
		expect(child.unref).toHaveBeenCalled();
	});

	test('records the reading, so the question after it knows what to cut off', async () => {
		const { cwd, pidPath } = setupSpeech();

		await speakText({ cwd, text: 'Question: should it ship?' });

		expect(readFileSync(pidPath, 'utf8')).toBe('4242');
	});

	test('a new question cuts off the reading still playing rather than talking over it', async () => {
		const { cwd, kill } = setupSpeech({ recorded: '999' });

		await speakText({ cwd, text: 'Question: should it ship?' });

		expect(kill).toHaveBeenCalledWith(999);
	});

	test('the reading it cut off is replaced in the record, not just erased', async () => {
		const { cwd, pidPath } = setupSpeech({ recorded: '999' });

		await speakText({ cwd, text: 'Question: should it ship?' });

		// the question after this one has to find THIS reading to cut off — the
		// record clearing away with the old reading would leave it talked over
		expect(readFileSync(pidPath, 'utf8')).toBe('4242');
	});

	test('a failed spawn is listened for, because an unheard one would crash the hook', async () => {
		const { cwd, child } = setupSpeech();

		await speakText({ cwd, text: 'Question: should it ship?' });

		expect(child.on).toHaveBeenCalledWith('error', expect.any(Function));
	});

	test('a child that came up with no way in is left alone rather than written to', async () => {
		const { cwd, child } = setupSpeech({ withInputStream: false });

		await expect(speakText({ cwd, text: 'Question: should it ship?' })).resolves.toBeUndefined();

		expect(child.unref).toHaveBeenCalled();
	});

	test('a reading that never started records nothing to cut off later', async () => {
		const { cwd, pidPath, child } = setupSpeech();
		child.pid = undefined;

		await speakText({ cwd, text: 'Question: should it ship?' });

		expect(existsSync(pidPath)).toBe(false);
	});
});
