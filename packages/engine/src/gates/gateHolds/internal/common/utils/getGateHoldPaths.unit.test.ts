import { execSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getGateHoldPaths } from '#src/gates/gateHolds/internal/common/utils/getGateHoldPaths.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupGateHoldsFolder } from '#tests/helpers/setupGateHoldsFolder.ts';

/**
 * A primary checkout with a linked worktree added from it — the shape a queued
 * ticket runs its gates in, and the only shape where a per-worktree folder and
 * a shared one differ.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-119-gate-holds');

	execSync(`git worktree add -q -b lo-119-gate-holds "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

describe('getGateHoldPaths', () => {
	test('resolves the holds directory beside the reservation in the primary checkout', async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const paths = await getGateHoldPaths({ cwd: worktree });

		// asked from inside a linked worktree, the answer has to name the checkout
		// the siblings share — a worktree's own folder would give every worker a
		// private set of holds, so a ticket one of them blocked would run in the next
		expect({
			checkout: realpathSync(dirname(dirname(paths.dir))),
			tail: [basename(dirname(paths.dir)), basename(paths.dir)],
			ticketFile: paths.pathFor({ identifier: 'LO-119' }),
		}).toStrictEqual({
			checkout: realpathSync(primary),
			tail: ['.lightsout', 'gate-holds'],
			ticketFile: join(paths.dir, 'lo-119.json'),
		});
	});

	test("falls back to the run's own folder outside a repository", async () => {
		const { cwd } = setupGateHoldsFolder();

		const paths = await getGateHoldPaths({ cwd });

		// outside a repository there are no sibling worktrees to agree with, so the
		// run's own folder is the whole population — and answering it rather than
		// throwing is what keeps a directory that works today working
		expect(paths.dir).toBe(join(cwd, '.lightsout', 'gate-holds'));
	});
});
