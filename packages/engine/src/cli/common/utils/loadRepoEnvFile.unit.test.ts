import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, jest, test } from '@jest/globals';
import { loadRepoEnvFile } from '#src/cli/common/utils/loadRepoEnvFile.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

const trackerKey = 'LIGHTSOUT_TEST_TRACKER_KEY';

const setupRepo = ({ contents }: { contents?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-env-file-'));

	if (contents !== undefined) {
		writeFileSync(join(cwd, '.env'), contents);
	}

	return { cwd };
};

/** A primary checkout carrying `.env`, plus a linked worktree added from it — which carries no `.env` unless a test writes one. */
const setupWorktreeRepo = ({ primaryContents, worktreeContents }: { primaryContents: string; worktreeContents?: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-60-ship-command');

	writeFileSync(join(cwd, '.env'), primaryContents);
	execSync(`git worktree add -q -b lo-60-ship-command "${worktree}" main`, { cwd, stdio: 'ignore' });

	if (worktreeContents !== undefined) {
		writeFileSync(join(worktree, '.env'), worktreeContents);
	}

	return { cwd, worktree };
};

// The spies on `console.error` are restored by the shared Jest config between
// tests; only the variable this file writes into the real environment is ours
// to take back out.
afterEach(() => {
	delete process.env[trackerKey];
});

test('loadRepoEnvFile: a key in .env reaches the environment, so a command need not be prefixed with it', async () => {
	const { cwd } = setupRepo({ contents: `${trackerKey}=from_file\n` });

	await loadRepoEnvFile({ cwd });

	expect(process.env[trackerKey]).toBe('from_file');
});

test('loadRepoEnvFile: a variable already exported wins over the file, so a CI secret is never overwritten', async () => {
	const { cwd } = setupRepo({ contents: `${trackerKey}=from_file\n` });
	process.env[trackerKey] = 'from_environment';

	await loadRepoEnvFile({ cwd });

	expect(process.env[trackerKey]).toBe('from_environment');
});

test('loadRepoEnvFile: a repository with no .env is silent, because most have none and every command must still run', async () => {
	const { cwd } = setupRepo();
	const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

	await loadRepoEnvFile({ cwd });

	expect(errors).not.toHaveBeenCalled();
	expect(process.env[trackerKey]).toBe(undefined);
});

test('loadRepoEnvFile: a .env that cannot be read is reported and the command carries on, rather than failing the run', async () => {
	const { cwd } = setupRepo();
	mkdirSync(join(cwd, '.env'));
	const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);

	await expect(loadRepoEnvFile({ cwd })).resolves.toBe(undefined);
	expect(errors).toHaveBeenCalledWith(expect.stringContaining(join(cwd, '.env')));
});

test('loadRepoEnvFile: comments and quoted values are read the way Node reads them', async () => {
	const { cwd } = setupRepo({ contents: `# the tracker key\n${trackerKey}="two words"\n` });

	await loadRepoEnvFile({ cwd });

	expect(process.env[trackerKey]).toBe('two words');
});

test('loadRepoEnvFile: a linked worktree with no .env of its own reads the primary checkout’s, so a command run from a worktree finds the tracker key', async () => {
	const { worktree } = setupWorktreeRepo({ primaryContents: `${trackerKey}=from_primary\n` });

	await loadRepoEnvFile({ cwd: worktree });

	expect(process.env[trackerKey]).toBe('from_primary');
});

test('loadRepoEnvFile: a linked worktree carrying its own .env reads that one and not the primary checkout’s — the nearest file wins', async () => {
	const { worktree } = setupWorktreeRepo({ primaryContents: `${trackerKey}=from_primary\n`, worktreeContents: `${trackerKey}=from_worktree\n` });

	await loadRepoEnvFile({ cwd: worktree });

	expect(process.env[trackerKey]).toBe('from_worktree');
});
