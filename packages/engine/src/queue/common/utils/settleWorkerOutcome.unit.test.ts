import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { readBranchState } from '#src/queue/branchState/index.ts';
import { settleWorkerOutcome } from '#src/queue/common/utils/settleWorkerOutcome.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupTicketBranch } from '#tests/helpers/setupTicketBranch.ts';

/** What `git rev-parse HEAD` answers in a worktree — the fact a second commit would change. */
const headOf = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd }).toString().trim();

/**
 * A ticket branch as a worker leaves it once the pipeline has committed each
 * unit itself: a clean tree standing on commits the branch carries ahead of the
 * default branch.
 */
const setupSettledWorker = () => {
	const { cwd, runDir } = setupTicketBranch();

	return {
		cwd,
		head: headOf({ cwd }),
		params: {
			cwd,
			worktreePath: cwd,
			branch: 'lo-70-drain',
			defaultBranch: 'main',
			ticket: queueTicketFixture(),
			workOrderRunDir: runDir,
			generated: undefined,
			worked: {},
		},
	};
};

describe('settleWorkerOutcome', () => {
	test('reports a branch ready from the commits it already carries', async () => {
		const { cwd, head, params } = setupSettledWorker();

		const settled = await settleWorkerOutcome(params);

		expect(settled).toStrictEqual({ ready: true });
		expect(headOf({ cwd })).toBe(head);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ branch: 'lo-70-drain', phase: 'ready' }));
	});
});
