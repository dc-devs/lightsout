import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readGitCommittedFile } from '#src/common/git/readGitCommittedFile.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

describe('readGitCommittedFile', () => {
	test('a tracked file reads back exactly as it was committed', async () => {
		const cwd = setupConsumerRepo();

		const content = await readGitCommittedFile({ cwd, path: 'src/index.js' });

		// the committed bytes, not the working tree's — this is the question the
		// ledger step asks about a test file that may already exist
		expect(content).toBe('export const one = 1;\n');
	});

	test('a file that exists only in the working tree reads back as absent', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, 'src/fresh.js'), 'export const fresh = 2;\n');

		const content = await readGitCommittedFile({ cwd, path: 'src/fresh.js' });

		// a run starts from a clean tree, so anything the run itself wrote is
		// invisible here — which is what makes the ledger step's refusal read the
		// same on a re-entry after a park as it did on the first pass
		expect(content).toBe(undefined);
	});

	test('a path HEAD does not track reads back as absent rather than raising', async () => {
		const cwd = setupConsumerRepo();

		expect(await readGitCommittedFile({ cwd, path: 'src/never/existed.js' })).toBe(undefined);
	});

	test('a path whose name would otherwise be shell syntax is read as data', async () => {
		const cwd = setupConsumerRepo();

		writeFileSync(join(cwd, 'src/od$d name.js'), 'export const odd = 3;\n');
		execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm odd', { cwd });

		// the path is quoted for the shell, so a `$` in it names a file rather
		// than expanding to an empty variable
		expect(await readGitCommittedFile({ cwd, path: 'src/od$d name.js' })).toBe('export const odd = 3;\n');
	});

	test('a directory outside any worktree reports undefined', async () => {
		const cwd = setupConsumerRepo({ git: false });

		// absence is a value: the caller decides what "no committed version"
		// means, and git never being answerable is one way to get there
		expect(await readGitCommittedFile({ cwd, path: 'src/index.js' })).toBe(undefined);
	});
});
