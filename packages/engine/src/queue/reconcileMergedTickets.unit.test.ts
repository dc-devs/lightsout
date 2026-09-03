import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import { reconcileMergedTickets } from '#src/queue/reconcileMergedTickets.ts';
import type { PullRequestSummary } from '#src/ship/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The forge read, the tracker write, the git status read and the worktree
// removal each have their own tests. What this file owns is the policy: what
// counts as confirmation, which tickets survive, and what happens to the
// worktree a reconciled ticket leaves behind.
const mockFindPullRequest = jest.fn<(params: { branch: string; cwd: string; state: string }) => Promise<PullRequestSummary | undefined>>();
const mockReconcileShippedTicket = jest.fn<(params: { ticketRef: string | undefined }) => Promise<string | undefined>>();
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();
const mockRemoveTicketWorktree = jest.fn<(params: { cwd: string; worktreePath: string; branch: string }) => Promise<void>>();

jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	findPullRequest: (params: { branch: string; cwd: string; state: string }) => mockFindPullRequest(params),
}));
jest.mock('#src/ticketLifecycle/index.ts', () => ({
	reconcileShippedTicket: (params: { ticketRef: string | undefined }) => mockReconcileShippedTicket(params),
}));
jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({ readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params) }));
jest.mock('#src/queue/removeTicketWorktree.ts', () => ({
	removeTicketWorktree: (params: { cwd: string; worktreePath: string; branch: string }) => mockRemoveTicketWorktree(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const ticketOf = ({ number }: { number: number }): RunnableTicket => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	unfinishedBlockers: [],
});

const mergedPullRequest: PullRequestSummary = { number: 41, url: 'https://forge.example/pull/41', title: 'LO-70', branch: 'lo-70-ticket-70' };

/** What `git status` finds in the ticket's worktree: nothing to commit, something to commit, or no worktree there at all. */
const changedFilesFor = { clean: [] as string[], dirty: ['src/a.ts'], absent: undefined };

/** A wave whose branches the forge answers for, one merged pull request per branch the test names. */
const setupReconcile = ({
	merged = [],
	worktree = 'clean',
	reconciliationFailure,
}: {
	merged?: number[];
	worktree?: keyof typeof changedFilesFor;
	reconciliationFailure?: string;
} = {}) => {
	const progress: string[] = [];

	mockFindPullRequest.mockImplementation(({ branch }) =>
		Promise.resolve(merged.some((number) => branch.startsWith(`lo-${number}-`)) ? mergedPullRequest : undefined),
	);
	mockReconcileShippedTicket.mockResolvedValue(reconciliationFailure);
	mockReadGitChangedFiles.mockResolvedValue(changedFilesFor[worktree]);

	const reconcile = ({ numbers }: { numbers: number[] }) =>
		reconcileMergedTickets({
			cwd: '/repo',
			config,
			env: {},
			settings: queueSettingsFixture(),
			tickets: numbers.map((number) => ticketOf({ number })),
			onProgress: (message) => progress.push(message),
		});

	return { reconcile, progress };
};

describe('reconcileMergedTickets', () => {
	test('keeps a ticket whose branch has no merged pull request, which is every ticket the queue is meant to run', async () => {
		const { reconcile } = setupReconcile();

		const { kept, leftBehind } = await reconcile({ numbers: [70, 71] });

		expect(kept.map((ticket) => ticket.identifier)).toStrictEqual(['LO-70', 'LO-71']);
		expect(leftBehind).toStrictEqual([]);
	});

	test('asks the forge for a merged pull request on the ticket’s own branch, since a merge is confirmed rather than inferred', async () => {
		const { reconcile } = setupReconcile();

		await reconcile({ numbers: [70] });

		expect(mockFindPullRequest).toHaveBeenCalledWith({ branch: 'lo-70-ticket-70', cwd: '/repo', state: 'merged' });
	});

	test('skips a ticket that already merged, and moves it to done rather than building it again', async () => {
		const { reconcile } = setupReconcile({ merged: [70] });

		const { kept, leftBehind } = await reconcile({ numbers: [70, 71] });

		expect(kept.map((ticket) => ticket.identifier)).toStrictEqual(['LO-71']);
		expect(mockReconcileShippedTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'LO-70' }));
		expect(leftBehind).toStrictEqual([
			{
				identifier: 'LO-70',
				reason: 'skipped: its branch lo-70-ticket-70 already has a merged pull request #41, so the ticket was reconciled to done rather than built again',
				settled: true,
			},
		]);
	});

	test('marks the skip settled, because a reconciled ticket is finished rather than work a re-run picks up', async () => {
		const { reconcile } = setupReconcile({ merged: [70] });

		const { leftBehind } = await reconcile({ numbers: [70] });

		expect(leftBehind[0]?.settled).toBe(true);
	});

	test('removes the clean worktree it left behind, so a later drain does not rediscover work that already shipped', async () => {
		const { reconcile } = setupReconcile({ merged: [70] });

		await reconcile({ numbers: [70] });

		expect(mockRemoveTicketWorktree).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo', branch: 'lo-70-ticket-70' }));
	});

	test('keeps a dirty worktree and says so, because a merged pull request says nothing about work begun in it since', async () => {
		const { reconcile } = setupReconcile({ merged: [70], worktree: 'dirty' });

		const { leftBehind } = await reconcile({ numbers: [70] });

		expect(mockRemoveTicketWorktree).not.toHaveBeenCalled();
		expect(leftBehind[0]?.reason).toContain('left in place because it has uncommitted changes');
	});

	test('touches nothing when there is no worktree for the branch at all', async () => {
		const { reconcile } = setupReconcile({ merged: [70], worktree: 'absent' });

		await reconcile({ numbers: [70] });

		expect(mockRemoveTicketWorktree).not.toHaveBeenCalled();
	});

	test('still skips the ticket when the done write failed, folding the reason into the report rather than running it', async () => {
		const { reconcile, progress } = setupReconcile({ merged: [70], reconciliationFailure: "LO-70 shipped, but no 'Done' transition" });

		const { kept, leftBehind } = await reconcile({ numbers: [70] });

		expect(kept).toStrictEqual([]);
		expect(leftBehind[0]?.reason).toContain("LO-70 shipped, but no 'Done' transition");
		expect(progress).toContain("LO-70 shipped, but no 'Done' transition");
	});
});
