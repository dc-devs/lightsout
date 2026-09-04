import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { commitTicketWork } from '#src/queue/index.ts';
import { committedPaths } from '#tests/helpers/committedPaths.ts';
import { generatedPaths } from '#tests/helpers/generatedPaths.ts';
import { headSubject } from '#tests/helpers/headSubject.ts';
import { setupTicketBranch } from '#tests/helpers/setupTicketBranch.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// Git itself stays real: the repository below is a real one, and every command
// but the single named one runs against it. Only the process spawner is
// doubled, and only for the refusals a real repository cannot be arranged into
// from outside — a git read that fails after the git write before it worked,
// and a worktree restore git refuses once the index is already back at HEAD.
interface RunCommandParams {
	command: string;
	cwd: string;
	timeoutMs?: number;
}

const actual = jest.requireActual<typeof import('#src/common/processes/runCommand.ts')>('#src/common/processes/runCommand.ts');
const mockRunCommand = jest.fn<(params: RunCommandParams) => Promise<CommandResult> | undefined>();

jest.mock('#src/common/processes/runCommand.ts', () => ({
	runCommand: (params: RunCommandParams) => mockRunCommand(params) ?? actual.runCommand(params),
}));
// -------------------------

/** One command the spawner answers for itself; everything else reaches real git. */
interface Interception {
	/** Matched against the start of the command line. */
	command: string;
	/** What git answered, or omitted for the spawn that never answered at all. */
	result?: CommandResult;
}

/**
 * The shared ticket-branch fixture, with the spawner set to answer for at most
 * one named command and to reach real git for every other.
 */
const setupInterceptedBranch = ({ intercept }: { intercept?: Interception } = {}) => {
	mockRunCommand.mockImplementation(({ command }) => {
		if (intercept === undefined || !command.startsWith(intercept.command)) {
			return undefined;
		}

		return intercept.result === undefined ? Promise.reject(new Error('spawn git ENOENT')) : Promise.resolve(intercept.result);
	});

	return setupTicketBranch();
};

describe('commitTicketWork', () => {
	test('says the split of the generated paths failed rather than guessing which of them git tracks', async () => {
		const { cwd, runDir } = setupInterceptedBranch({
			intercept: { command: 'git ls-files', result: { exitCode: 128, stdout: '', stderr: 'fatal: index file corrupt' } },
		});

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 split unreadable', runDir, generated: generatedPaths });

		// Guessing would restore files git never tracked or clean files it does —
		// so the whole discard stops here, and no commit is claimed over it.
		expect(committed).toStrictEqual({ error: `git could not discard the generated changes in ${cwd}: git could not tell which generated paths are tracked` });
		expect(headSubject({ cwd })).toBe('ignore');
	});

	test('says the same when the split never answered at all, because a spawn that failed is not an empty answer', async () => {
		const { cwd, runDir } = setupInterceptedBranch({ intercept: { command: 'git ls-files' } });

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 split unanswered', runDir, generated: generatedPaths });

		// An unanswered read must never read as "nothing is tracked": that would
		// send `git clean` at a file git holds a committed copy of.
		expect(committed).toStrictEqual({ error: `git could not discard the generated changes in ${cwd}: git could not tell which generated paths are tracked` });
		expect(headSubject({ cwd })).toBe('ignore');
	});

	test("reports git's own words when it refuses to restore a tracked generated file, rather than committing the rebuilt copy", async () => {
		const { cwd, runDir } = setupInterceptedBranch({
			intercept: { command: 'git checkout', result: { exitCode: 1, stdout: '', stderr: 'error: unable to write file plugin/dist/cli.mjs\n' } },
		});

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/cli.mjs', content: '// rebuilt on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 restore refused', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ error: `git could not discard the generated changes in ${cwd}: error: unable to write file plugin/dist/cli.mjs` });
		expect(headSubject({ cwd })).toBe('ignore');
	});

	test('discards a generated path whose name carries a single quote, which would otherwise close the pathspec early', async () => {
		const { cwd, runDir } = setupInterceptedBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: "plugin/dist/it's.mjs", content: '// built on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 quoted name', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['src.ts']);
		expect(existsSync(join(cwd, 'plugin', 'dist', "it's.mjs"))).toBe(false);
	});

	test('writes a message that already ends in a newline unchanged, so no commit gains a blank line under its subject', async () => {
		const { cwd, runDir } = setupInterceptedBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 already terminated\n', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(readFileSync(join(runDir, 'commit-message.txt'), 'utf8')).toBe('LO-79 already terminated\n');
		expect(headSubject({ cwd })).toBe('LO-79 already terminated');
	});
});
