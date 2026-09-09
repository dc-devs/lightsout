import { describe, expect, jest, test } from '@jest/globals';
import type { CommandResult } from '#src/common/types/CommandResult.ts';
import { ShipMergeMethod } from '#src/contracts/index.ts';
import { mergePullRequest } from '#src/ship/forge/index.ts';
import { runGh } from '#src/ship/forge/runGh.ts';

// The forge command is mocked rather than stubbed onto PATH: confirming a merge
// the forge only queued polls for up to half an hour, and the fake clock that
// makes those polls instant also runs out a real child process's own deadline —
// so a stubbed `gh` would be killed mid-answer instead of replying.
jest.mock('#src/ship/forge/runGh.ts', () => ({ runGh: jest.fn<typeof runGh>() }));

const mockRunGh = jest.mocked(runGh);

/** What one `gh` invocation answers with; anything left out is the empty, successful answer. */
interface ForgeAnswer {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
}

/**
 * A forge that answers the merge request one way and the read-backs another.
 *
 * A list of read-backs answers one entry per read in order and repeats its last
 * entry from then on — the only way to model a pull request whose state changes
 * while it is being polled.
 */
const setupForge = ({ merge = {}, view }: { merge?: ForgeAnswer; view: ForgeAnswer | ForgeAnswer[] }) => {
	const views = [view].flat();
	let read = 0;

	mockRunGh.mockReset();
	mockRunGh.mockImplementation(({ args }): Promise<CommandResult> => {
		const answer = (args[1] === 'merge' ? merge : views[Math.min(read++, views.length - 1)]) ?? {};

		return Promise.resolve({ exitCode: answer.exitCode ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' });
	});

	return { asked: () => mockRunGh.mock.calls.map(([call]) => call.args.join(' ')) };
};

/** A forge that merges as the test says it does, and reports the commit it produced. */
const setupMerge = ({
	mergeExit = 0,
	mergeStderr = '',
	viewStdout = '{"state":"MERGED","mergeCommit":{"oid":"0f1e2d3c"}}',
	viewStderr = '',
}: {
	mergeExit?: number;
	mergeStderr?: string;
	viewStdout?: string;
	viewStderr?: string;
} = {}) => setupForge({ merge: { exitCode: mergeExit, stderr: mergeStderr }, view: { stdout: viewStdout, stderr: viewStderr } });

/** The commit this invocation pushed and is asking the forge to merge — the only head it is ever allowed to merge. */
const candidateHead = 'b7d4e9f10a2b3c4d5e6f708192a3b4c5d6e7f809';

/** A commit someone else pushed to the same branch afterwards, which this invocation has verified nothing about. */
const supersedingHead = '3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b';

/**
 * The forge's own words when it refuses, identical across every state below.
 *
 * It is GitHub's real stale-base sentence, so a classifier that reads the
 * message rather than the pull request's structured state calls all of these
 * recoverable — and fails on the six that are not.
 */
const refusalStderr = 'Base branch was modified. Review and try the merge again.';

/** The condition every merge request carries, whichever method it asks for. */
const headCondition = `--match-head-commit ${candidateHead}`;

/** One `gh pr view` read-back, in the shape the merge outcome is classified from. */
const readBack = ({
	state,
	mergeCommit = null,
	headRefOid = candidateHead,
	mergeStateStatus = 'CLEAN',
	reviewDecision = null,
}: {
	state: string;
	mergeCommit?: string | null;
	headRefOid?: string;
	mergeStateStatus?: string;
	reviewDecision?: string | null;
}) => JSON.stringify({ state, mergeCommit: mergeCommit === null ? null : { oid: mergeCommit }, headRefOid, mergeStateStatus, reviewDecision });

/** What one refused merge came to mean: another attempt is warranted, the merge in fact landed, or the sequence stops here. */
const classifyRefusal = async ({ view }: { view: string }) => {
	setupMerge({ mergeExit: 1, mergeStderr: refusalStderr, viewStdout: view });

	const outcome = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

	return typeof outcome === 'string' ? 'merged' : outcome.staleBase === true ? 'stale-base' : 'terminal';
};

/** One merge request, and what the forge was asked for to produce it. */
const askForMethod = async ({ mergeMethod }: { mergeMethod: ShipMergeMethod }) => {
	const { asked } = setupForge({ view: { stdout: readBack({ state: 'MERGED', mergeCommit: 'c4d5e6f7' }) } });

	const shipped = await mergePullRequest({ prNumber: 41, mergeMethod, expectedHead: candidateHead, cwd: '/repo' });

	return { asked: asked()[0], shipped };
};

/** A forge that accepts the merge into its queue and reports the pull request still open for two reads before the queue lands it. */
const setupQueuedMerge = () => {
	const forge = setupForge({
		merge: { stdout: 'Enqueued pull request #41 for merge' },
		view: [
			{ stdout: readBack({ state: 'OPEN' }) },
			{ stdout: readBack({ state: 'OPEN' }) },
			{ stdout: readBack({ state: 'MERGED', mergeCommit: 'e5f60718' }) },
		],
	});

	// The clock is faked so the confirmation polls cost no real minutes; the
	// forge answers from memory, so nothing is in flight when the clock jumps.
	jest.useFakeTimers();

	return forge;
};

/**
 * A forge that accepted the merge and never lands it, polled all the way to the
 * half-hour ceiling on the same faked clock.
 *
 * The read-back never changes, so what comes back is what a merge queue that
 * stalled — or a forge whose answer stopped parsing — leaves the sequence
 * holding once the wait is spent.
 */
const confirmUntilCeiling = async ({ view }: { view: string }) => {
	const ceilingMs = 30 * 60_000;

	setupForge({ merge: { stdout: 'Enqueued pull request #41 for merge' }, view: { stdout: view } });
	jest.useFakeTimers();

	const merging = mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

	await jest.advanceTimersByTimeAsync(ceilingMs + 60_000);

	return merging;
};

describe('mergePullRequest', () => {
	test('answers with the commit the merge produced on the default branch', async () => {
		setupMerge();

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

		expect(mergeCommit).toBe('0f1e2d3c');
	});

	test('asks the forge for the configured method and to delete the branch, which is the cleanup step', async () => {
		const { asked } = setupMerge();

		await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Squash, expectedHead: candidateHead, cwd: '/repo' });

		expect(asked()[0]).toBe(`pr merge 41 --squash --delete-branch --match-head-commit ${candidateHead}`);
	});

	test('a refused merge answers with the forge’s own reason, once the read-back confirms nothing landed', async () => {
		const { asked } = setupMerge({ mergeExit: 1, mergeStderr: 'protected branch', viewStdout: '{"state":"OPEN","mergeCommit":null}' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

		expect(mergeCommit).toStrictEqual({ stderr: 'protected branch' });
		expect(asked()).toStrictEqual([
			`pr merge 41 --merge --delete-branch --match-head-commit ${candidateHead}`,
			'pr view 41 --json state,mergeCommit,headRefOid,mergeStateStatus,reviewDecision',
		]);
	});

	test('a merge whose command failed only on local cleanup is still a merge — the forge’s state outranks the exit code', async () => {
		setupMerge({
			mergeExit: 1,
			mergeStderr: "failed to run git: fatal: 'main' is already used by worktree at '/repo'",
			viewStdout: '{"state":"MERGED","mergeCommit":{"oid":"a1b2c3d4"}}',
		});

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

		expect(mergeCommit).toBe('a1b2c3d4');
	});

	test('a failed merge whose read-back cannot be parsed keeps the failure, rather than guessing the merge landed', async () => {
		setupMerge({ mergeExit: 1, mergeStderr: 'protected branch', viewStdout: 'not json at all' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

		expect(mergeCommit).toStrictEqual({ stderr: 'protected branch' });
	});

	test('a merge whose commit cannot be read answers a failure rather than a made-up commit', async () => {
		setupMerge({ viewStdout: '{"state":"MERGED","mergeCommit":null}' });

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

		expect(mergeCommit).toStrictEqual({ stderr: '' });
	});

	test('a commit the forge would not name answers the read-back’s own words, not whatever the merge printed', async () => {
		setupMerge({
			mergeStderr: 'merged, and the branch was deleted',
			viewStdout: '{"state":"MERGED","mergeCommit":null}',
			viewStderr: 'could not read the merge commit',
		});

		const mergeCommit = await mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });

		expect(mergeCommit).toStrictEqual({ stderr: 'could not read the merge commit' });
	});

	test('classifies merge recovery from structured state', async () => {
		const classified = {
			behind: await classifyRefusal({ view: readBack({ state: 'OPEN', mergeStateStatus: 'BEHIND' }) }),
			blocked: await classifyRefusal({ view: readBack({ state: 'OPEN', mergeStateStatus: 'BLOCKED' }) }),
			reviewRequired: await classifyRefusal({ view: readBack({ state: 'OPEN', mergeStateStatus: 'BEHIND', reviewDecision: 'REVIEW_REQUIRED' }) }),
			changesRequested: await classifyRefusal({ view: readBack({ state: 'OPEN', mergeStateStatus: 'BEHIND', reviewDecision: 'CHANGES_REQUESTED' }) }),
			supersededHead: await classifyRefusal({ view: readBack({ state: 'OPEN', mergeStateStatus: 'BEHIND', headRefOid: supersedingHead }) }),
			unknownState: await classifyRefusal({ view: readBack({ state: 'OPEN', mergeStateStatus: 'UNKNOWN' }) }),
			unreadable: await classifyRefusal({ view: 'not json at all' }),
		};

		expect(classified).toStrictEqual({
			behind: 'stale-base',
			blocked: 'terminal',
			reviewRequired: 'terminal',
			changesRequested: 'terminal',
			supersededHead: 'terminal',
			unknownState: 'terminal',
			unreadable: 'terminal',
		});
	});

	test('merges only the expected head and confirms remote completion', async () => {
		const asked = {
			merge: await askForMethod({ mergeMethod: ShipMergeMethod.Merge }),
			squash: await askForMethod({ mergeMethod: ShipMergeMethod.Squash }),
			rebase: await askForMethod({ mergeMethod: ShipMergeMethod.Rebase }),
		};
		const { asked: queuedCalls } = setupQueuedMerge();

		const merging = mergePullRequest({ prNumber: 41, mergeMethod: ShipMergeMethod.Merge, expectedHead: candidateHead, cwd: '/repo' });
		await jest.advanceTimersByTimeAsync(61_000);
		const queued = await merging;

		expect(asked).toEqual({
			merge: { asked: expect.stringContaining('--merge'), shipped: 'c4d5e6f7' },
			squash: { asked: expect.stringContaining('--squash'), shipped: 'c4d5e6f7' },
			rebase: { asked: expect.stringContaining('--rebase'), shipped: 'c4d5e6f7' },
		});
		expect([asked.merge.asked, asked.squash.asked, asked.rebase.asked]).toEqual([
			expect.stringContaining(headCondition),
			expect.stringContaining(headCondition),
			expect.stringContaining(headCondition),
		]);
		expect(queued).toBe('e5f60718');
		expect(queuedCalls().filter((line) => line.startsWith('pr merge'))).toHaveLength(1);
	});

	test('an accepted merge the forge never confirms runs out the wait rather than reporting a ship', async () => {
		const stillOpen = await confirmUntilCeiling({ view: readBack({ state: 'OPEN' }) });
		const unreadable = await confirmUntilCeiling({ view: 'not json at all' });

		// A zero exit is not the answer: the pull request is still open, so the
		// sequence is handed the pending remote state instead of a merge commit —
		// and a read-back that stopped parsing says so rather than naming a state.
		expect(stillOpen).toStrictEqual({ stderr: 'the forge accepted the merge but #41 is still OPEN at the wait ceiling' });
		expect(unreadable).toStrictEqual({ stderr: 'the forge accepted the merge but #41 is still unreadable at the wait ceiling' });
	});
});
