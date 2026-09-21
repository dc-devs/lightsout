import { execSync } from 'node:child_process';
import { mkdtempSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveSharedStateDir } from '#src/common/workspace/resolveSharedStateDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree added from it — the shape every
 * queued ticket runs its gates in, and the one place two runs can disagree
 * about where the shared state lives.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-119-gate-lock');

	execSync(`git worktree add -q -b lo-119-gate-lock "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

/** A directory with no repository above it, so git can answer nothing. */
const setupLooseDirectory = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-shared-state-'));

	return { cwd };
};

/**
 * A second spelling of the primary checkout, reached through a symlink — which
 * is every temporary directory on macOS, and what git answers with the resolved
 * path for. A path relativised against a resolved root it was never spelled
 * with walks up out of the state directory and reads as no plan at all.
 */
const setupSymlinkedCheckout = () => {
	const { cwd } = setupBranchRepo();
	const symlinked = join(mkdtempSync(join(tmpdir(), 'lightsout-symlinked-')), 'checkout');

	symlinkSync(cwd, symlinked, 'dir');

	return { primary: cwd, symlinked };
};

describe('resolveSharedStateDir', () => {
	test("answers the primary checkout's .lightsout from inside a linked worktree, so sibling worktrees share one file", async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const sharedStateDir = await resolveSharedStateDir({ cwd: worktree });

		expect({ parent: realpathSync(dirname(sharedStateDir)), name: basename(sharedStateDir) }).toStrictEqual({
			parent: realpathSync(primary),
			name: '.lightsout',
		});
	});

	test("falls back to the run's own .lightsout when no primary checkout resolves", async () => {
		const { cwd } = setupLooseDirectory();

		const sharedStateDir = await resolveSharedStateDir({ cwd });

		expect(sharedStateDir).toBe(join(cwd, '.lightsout'));
	});

	test('resolveSharedStateDir: a symlinked spelling of the primary checkout is kept as the caller wrote it', async () => {
		const { primary, symlinked } = setupSymlinkedCheckout();

		const sharedStateDir = await resolveSharedStateDir({ cwd: symlinked });

		expect({
			answer: sharedStateDir,
			isGitsResolvedSpelling: sharedStateDir === join(realpathSync(primary), '.lightsout'),
		}).toStrictEqual({ answer: join(symlinked, '.lightsout'), isGitsResolvedSpelling: false });
	});

	test("resolveSharedStateDir: a linked worktree is still answered the primary checkout's state directory", async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const sharedStateDir = await resolveSharedStateDir({ cwd: worktree });

		expect({
			parent: realpathSync(dirname(sharedStateDir)),
			name: basename(sharedStateDir),
			isWorktreesOwn: sharedStateDir === join(worktree, '.lightsout'),
		}).toStrictEqual({ parent: realpathSync(primary), name: '.lightsout', isWorktreesOwn: false });
	});
});
