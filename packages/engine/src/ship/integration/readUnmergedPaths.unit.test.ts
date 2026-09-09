import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readUnmergedPaths } from '#src/ship/integration/readUnmergedPaths.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const author = '-c user.name=t -c user.email=t@t';

/**
 * A repo standing on `main` with a conflicted merge of `feature` left open:
 * every named file was changed on both sides, so git leaves them all unmerged.
 *
 * Git is real here rather than stubbed, because what counts as an unmerged path
 * is git's own answer — a stubbed one would only re-state the test's guess.
 */
const setupConflictedMerge = ({ names }: { names: string[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-unmerged-'));
	const git = (command: string) => execSync(command, { cwd, stdio: 'ignore' });
	const write = ({ content }: { content: string }) => {
		for (const name of names) {
			writeFileSync(join(cwd, name), content);
		}
	};

	git('git init -q -b main .');
	git('git config user.name t && git config user.email t@t');
	write({ content: 'base\n' });
	git('git add -A');
	git(`git ${author} commit -qm base`);

	git('git checkout -q -b feature');
	write({ content: 'feature side\n' });
	git('git add -A');
	git(`git ${author} commit -qm feature`);

	git('git checkout -q main');
	write({ content: 'main side\n' });
	git('git add -A');
	git(`git ${author} commit -qm main`);

	// The merge is expected to exit non-zero: the conflict it leaves behind is
	// the arrangement, not a failure of the fixture.
	try {
		git(`git ${author} merge --no-commit --no-ff feature`);
	} catch {
		// conflicted, as arranged
	}

	return cwd;
};

describe('readUnmergedPaths', () => {
	test('tells an unreadable git apart from a tree with nothing unmerged', async () => {
		const conflicted = setupConflictedMerge({ names: ['left.txt', 'right.txt'] });
		const outsideAnyWorktree = setupConsumerRepo({ git: false });

		const unmerged = await readUnmergedPaths({ cwd: conflicted });
		const unreadable = await readUnmergedPaths({ cwd: outsideAnyWorktree });

		expect(unmerged).toEqual(['left.txt', 'right.txt']);
		// undefined and not [] — a git that could not be read is missing evidence,
		// and reporting it as "nothing unmerged" would let a conflict be committed
		expect(unreadable).toBe(undefined);
	});

	test('preserves unusual filenames as data while reading unmerged paths', async () => {
		// Spaces, both quote characters, a leading space that a trim would eat, a
		// newline that a line-based parser would split, and shell syntax that a
		// command built by string concatenation would execute.
		const names = [' leading space.txt', 'it\'s "quoted".txt', '$(touch pwned);echo.txt', 'line\nbreak.txt'];
		const cwd = setupConflictedMerge({ names });

		const unmerged = await readUnmergedPaths({ cwd });

		expect([...(unmerged ?? [])].sort()).toEqual([...names].sort());
		// the path was read as data: nothing in it ran
		expect(existsSync(join(cwd, 'pwned'))).toBe(false);
	});
});
