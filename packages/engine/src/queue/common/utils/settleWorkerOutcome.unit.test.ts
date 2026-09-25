import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import { readBranchState } from '#src/queue/branchState/readBranchState.ts';
import { settleWorkerOutcome } from '#src/queue/common/utils/settleWorkerOutcome.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { headSubject } from '#tests/helpers/headSubject.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { setupTicketBranch } from '#tests/helpers/setupTicketBranch.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

/** What `git rev-parse HEAD` answers in a worktree — the fact a second commit would change. */
const headOf = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd }).toString().trim();

/** The whole message of the newest commit — where the body's `lightsout run` line is read from. */
const headMessageOf = ({ cwd }: { cwd: string }) => execSync('git log -1 --pretty=%B', { cwd }).toString();

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/**
 * A ticket branch as a worker leaves it once the pipeline has committed each
 * unit itself: a clean tree standing on commits the branch carries ahead of the
 * default branch.
 */
const setupSettledWorker = ({
	driver = createUncalledDriver({ reason: 'a settled branch has nothing to commit, so no commit message is asked for' }),
}: {
	/** The harness the queue holds — the commit-message agent runs on it. */
	driver?: Driver;
} = {}) => {
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
			config,
			driver,
			coordinatorRunId: 'queue-run-1',
			worked: {},
		},
	};
};

/**
 * A ticket branch whose worker left one source file uncommitted, settled on a
 * stub harness that answers the commit-message agent with `answer` — or throws
 * `error`, as a harness that is down does.
 */
const setupLeftoverWorker = ({ answer = '', error }: { answer?: string; error?: Error }) => {
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			if (error) {
				throw error;
			}

			return { text: answer, exitCode: 0 };
		},
	};
	const settled = setupSettledWorker({ driver });

	writeRepoFile({ cwd: settled.cwd, path: 'src/leftover.ts', content: 'export const leftover = 1;\n' });

	return settled;
};

describe('settleWorkerOutcome', () => {
	test('reports a branch ready from the commits it already carries', async () => {
		const { cwd, head, params } = setupSettledWorker();

		const settled = await settleWorkerOutcome(params);

		expect(settled).toStrictEqual({ ready: true });
		expect(headOf({ cwd })).toBe(head);
		expect(await readBranchState({ cwd, branch: 'lo-70-drain' })).toEqual(expect.objectContaining({ branch: 'lo-70-drain', phase: 'ready' }));
	});

	test("settleWorkerOutcome: commits a worker's leftover source change under the ticket identifier and the agent's summary, naming the coordinator run in the body", async () => {
		const { cwd, head, params } = setupLeftoverWorker({ answer: JSON.stringify({ summary: 'add the leftover module' }) });

		const settled = await settleWorkerOutcome(params);

		expect(settled).toStrictEqual({ ready: true });
		expect(headOf({ cwd })).not.toBe(head);
		expect(headSubject({ cwd })).toBe('LO-70: add the leftover module');
		expect(headMessageOf({ cwd })).toContain('\nlightsout run queue-run-1\n');
	});

	test("settleWorkerOutcome: commits under the ticket's identifier and title when the driver throws, still naming the coordinator run", async () => {
		const { cwd, head, params } = setupLeftoverWorker({ error: new Error('the harness is down') });

		const settled = await settleWorkerOutcome(params);

		expect(settled).toStrictEqual({ ready: true });
		expect(headOf({ cwd })).not.toBe(head);
		expect(headSubject({ cwd })).toBe('LO-70 Ticket 70');
		expect(headMessageOf({ cwd })).toContain('\nlightsout run queue-run-1\n');
	});

	test('settleWorkerOutcome: spends no agent call on a branch whose work is already committed', async () => {
		const invocations: DriverInvocation[] = [];
		const { cwd, head, params } = setupSettledWorker({
			driver: recordingDriver({ driver: createUncalledDriver({ reason: 'the branch is already committed' }), invocations }),
		});

		const settled = await settleWorkerOutcome(params);

		expect(settled).toStrictEqual({ ready: true });
		expect(headOf({ cwd })).toBe(head);
		expect(invocations).toHaveLength(0);
	});
});
