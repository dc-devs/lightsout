import { describe, expect, test } from '@jest/globals';
import { checkShipPreconditions } from '#src/ship/checkShipPreconditions.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { stubForgeOnPath } from '#tests/helpers/stubForgeOnPath.ts';

/** This repo's own pattern, which is also the shape the default one has. */
const ticketPattern = /^(?<ticket>lo-(?<number>\d+))/;

/** A checkout and a forge, each arranged to hold or to fail exactly one precondition. */
const setupPreconditions = async ({
	branch = 'lo-60-ship',
	onDefaultBranch = false,
	dirty,
	remoteHead = true,
	authExit = 0,
	worktree = true,
}: {
	branch?: string;
	/** Stand on `main` itself, which is the one arrangement no branch name can express. */
	onDefaultBranch?: boolean;
	dirty?: Record<string, string>;
	remoteHead?: boolean;
	authExit?: number;
	worktree?: boolean;
} = {}) => {
	stubForgeOnPath({ responses: { 'auth status': { exitCode: authExit } } });

	return worktree ? setupBranchRepo({ branch: onDefaultBranch ? undefined : branch, dirty, remoteHead }) : { cwd: await freshCwd() };
};

describe('checkShipPreconditions', () => {
	test('a clean feature branch on an authenticated forge hands back everything the sequence needs next', async () => {
		const { cwd } = await setupPreconditions();

		const preconditions = await checkShipPreconditions({ cwd, ticketPattern });

		expect(preconditions).toStrictEqual({ branch: 'lo-60-ship', defaultBranch: 'main', ticket: { ticket: 'lo-60', number: '60' } });
	});

	test('a directory that is not a worktree blocks before any branch name is known', async () => {
		const { cwd } = await setupPreconditions({ worktree: false });

		const preconditions = await checkShipPreconditions({ cwd, ticketPattern });

		expect(preconditions).toEqual({ reason: 'git-unreadable', detail: expect.stringContaining(cwd) });
	});

	test('standing on the default branch blocks, because ship would be merging it into itself', async () => {
		const { cwd } = await setupPreconditions({ onDefaultBranch: true });

		const preconditions = await checkShipPreconditions({ cwd, ticketPattern });

		expect(preconditions).toEqual(expect.objectContaining({ reason: 'default-branch', branch: 'main' }));
	});

	test('a remote with no head set blocks too, rather than guessing which branch the merge would land on', async () => {
		const { cwd } = await setupPreconditions({ remoteHead: false });

		const preconditions = await checkShipPreconditions({ cwd, ticketPattern });

		expect(preconditions).toEqual(expect.objectContaining({ reason: 'default-branch', detail: expect.stringContaining('origin/HEAD') }));
	});

	test('uncommitted work blocks and the detail names it, so the reader knows what to commit', async () => {
		const { cwd } = await setupPreconditions({ dirty: { 'notes.md': 'half a thought\n' } });

		const preconditions = await checkShipPreconditions({ cwd, ticketPattern });

		expect(preconditions).toEqual(expect.objectContaining({ reason: 'dirty-tree', detail: expect.stringContaining('notes.md') }));
	});

	test('a branch carrying no ticket blocks, and the detail quotes both the branch and the pattern', async () => {
		const { cwd } = await setupPreconditions({ branch: 'fix-the-thing' });

		const preconditions = await checkShipPreconditions({ cwd, ticketPattern });

		expect(preconditions).toEqual(expect.objectContaining({ reason: 'ticket-pattern-mismatch', detail: expect.stringContaining('fix-the-thing') }));
	});

	test('a forge that cannot speak for the repository blocks last, once everything local has held', async () => {
		const { cwd } = await setupPreconditions({ authExit: 1 });

		const preconditions = await checkShipPreconditions({ cwd, ticketPattern });

		expect(preconditions).toEqual(expect.objectContaining({ reason: 'forge-not-authenticated', branch: 'lo-60-ship' }));
	});
});
