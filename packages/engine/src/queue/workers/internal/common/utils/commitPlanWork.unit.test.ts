import { execFileSync } from 'node:child_process';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { DriverInvocation } from '#src/drivers/common/types/DriverInvocation.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/internal/common/types/WorkOrderPlanStep.ts';
import { commitPlanWork } from '#src/queue/workers/internal/common/utils/commitPlanWork.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { config, planOf, ticket, workOrderName } from '#tests/helpers/setupTicketPlanBuild.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// Only the staging-and-committing half of the commit module is stubbed: git
// commits on its own terms rather than on demand, and the claim here is about
// the message the primitive's composer writes. `composeCommitMessage` and
// `buildRunCommitMessage` are left real, so the stub awaits the composer it is
// handed with the step's cwd — the message asserted below is the one an actual
// commit would carry.
const mockCommitTicketWork = jest.fn<(params: CommitCall) => Promise<{ committed: false } | { committed: true; message: string } | { error: string }>>();

jest.mock('#src/commit/commitWorkOrderWork.ts', () => ({ commitWorkOrderWork: (params: CommitCall) => mockCommitTicketWork(params) }));
// -------------------------

/** What the commit primitive was handed, restated here because a `jest.mock` factory may not reach outside the file. */
interface CommitCall {
	cwd: string;
	composeMessage: ({ cwd }: { cwd: string }) => Promise<string>;
	runDir: string;
	generated?: string[];
	onProgress?: (message: string) => void;
}

/**
 * A leftover plan with run `run-1` recorded against it, and a stub commit
 * primitive that asks the composer it is handed for the message, as the real one
 * does once the change is staged.
 *
 * `staged` makes the step's cwd a real repo holding a staged source file;
 * otherwise it is a directory outside any git worktree, so the staged change
 * cannot be read. `answer` is the final text the step's driver gives every
 * invocation; without one the driver must never be invoked.
 */
const setupLeftoverCommit = ({ staged = false, answer }: { staged?: boolean; answer?: string } = {}) => {
	const invocations: DriverInvocation[] = [];
	const messages: string[] = [];
	const cwd = setupConsumerRepo({ git: staged });

	if (staged) {
		writeRepoFile({ cwd, path: 'src/searchIndex.ts', content: 'export const searchIndex = new Map<string, string>();\n' });
		execFileSync('git', ['add', '-A', '--', '.'], { cwd });
	}

	const answering: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			invocations.push(invocation);

			return { text: answer ?? '', exitCode: 0 };
		},
	};
	const driver = answer === undefined ? createUncalledDriver({ reason: 'an unreadable staged change must not reach the agent' }) : answering;

	mockCommitTicketWork.mockImplementation(async ({ cwd: worktree, composeMessage }) => {
		const message = await composeMessage({ cwd: worktree });
		messages.push(message);

		return { committed: true, message };
	});

	const plan = planOf({
		id: '001-search-index',
		title: 'Search index',
		progress: PlanProgress.Implemented,
		runId: 'run-1',
		finishedAt: '2026-01-03T00:00:00.000Z',
	});
	const record: WorkOrderState = {
		schemaVersion: 1,
		name: workOrderName,
		ticketRef: ticket.identifier,
		branch: workOrderName,
		mode: WorkOrderMode.MultiplePlan,
		plans: [plan],
		history: [],
	};
	const step: WorkOrderPlanStep = {
		cwd,
		record,
		plan,
		ticket,
		config,
		env: {},
		driver,
		driverName: driver.name,
		workOrderRunDir: `${cwd}/.lightsout/runs/run-1/ticket`,
	};

	return { step, invocations, messages };
};

describe('commitPlanWork', () => {
	test("commitPlanWork: in a tree git cannot read, commits under the template subject with the plan line and the owning plan's run line", async () => {
		const { step, messages } = setupLeftoverCommit();

		const refusal = await commitPlanWork({ step });

		expect({ refusal, messages }).toStrictEqual({
			refusal: undefined,
			messages: ['LO-7 001-search-index: Search index\n\nlightsout plan 001-search-index\nlightsout run run-1\n'],
		});
	});

	test("commitPlanWork: the composer it hands over asks the step's driver and opens the subject with the ticket identifier and the agent's summary", async () => {
		const { step, invocations, messages } = setupLeftoverCommit({ staged: true, answer: JSON.stringify({ summary: 'index the plans for search' }) });

		const refusal = await commitPlanWork({ step });

		// the plan line is what ties a leftover commit to its plan now that the
		// subject describes the change rather than naming the plan
		expect({ refusal, messages, asked: invocations.length }).toStrictEqual({
			refusal: undefined,
			messages: ['LO-7: index the plans for search\n\nlightsout plan 001-search-index\nlightsout run run-1\n'],
			asked: 1,
		});
	});
});
