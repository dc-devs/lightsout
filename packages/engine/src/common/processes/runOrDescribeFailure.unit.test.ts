import { describe, expect, jest, test } from '@jest/globals';
import { runOrDescribeFailure } from '#src/common/processes/runOrDescribeFailure.ts';
import type { CommandResult } from '#src/common/types/CommandResult.ts';

// Mocked Imports
// -------------------------
interface RunCommandParams {
	command: string;
	cwd: string;
	timeoutMs?: number;
}

const mockRunCommand = jest.fn<(params: RunCommandParams) => Promise<CommandResult>>();

jest.mock('#src/common/processes/runCommand.ts', () => ({
	runCommand: (params: RunCommandParams) => mockRunCommand(params),
}));
// -------------------------

/** What the spawner did: answered with a result, or never answered at all. */
type Answer = { result: CommandResult } | { rejection: string };

const setupCommandRunner = ({ answer }: { answer: Answer }) => {
	mockRunCommand.mockImplementation(() => ('rejection' in answer ? Promise.reject(new Error(answer.rejection)) : Promise.resolve(answer.result)));

	return { cwd: '/repo' };
};

describe('runOrDescribeFailure', () => {
	test('describes a non-zero exit, a silent process and a success as stderr, a subject sentence and undefined', async () => {
		const { cwd } = setupCommandRunner({ answer: { result: { exitCode: 128, stdout: '', stderr: '  fatal: not a git repository\n' } } });

		const exitFailure = await runOrDescribeFailure({ command: 'git status', cwd });

		expect(exitFailure).toBe('fatal: not a git repository');

		setupCommandRunner({ answer: { rejection: 'spawn ENOENT' } });

		const silentFailure = await runOrDescribeFailure({ command: 'pnpm install', cwd, subject: 'the setup command', timeoutMs: 500 });

		expect(silentFailure).toBe('the setup command did not answer');

		setupCommandRunner({ answer: { result: { exitCode: 0, stdout: 'ok', stderr: '' } } });

		const success = await runOrDescribeFailure({ command: 'git status', cwd });

		expect(success).toBeUndefined();
	});
});
