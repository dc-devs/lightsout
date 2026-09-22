import { describe, expect, jest, test } from '@jest/globals';
import { PlanProgress, WorkOrderMode, type WorkOrderState } from '#src/contracts/index.ts';
import type { WorkOrderPlanStep } from '#src/queue/workers/common/types/WorkOrderPlanStep.ts';
import { commitPlanWork } from '#src/queue/workers/common/utils/commitPlanWork.ts';
import { config, driver, planOf, ticket, ticketBranch } from '#tests/helpers/setupTicketPlanBuild.ts';

// Mocked Imports
// -------------------------
// Only the staging-and-committing half of the commit module is stubbed: git
// commits on its own terms rather than on demand, and the claim here is about
// the message the primitive is handed. `buildRunCommitMessage` is left real, so
// the body asserted below is the one an actual commit would carry.
const mockCommitTicketWork = jest.fn<(params: CommitCall) => Promise<{ committed: boolean } | { error: string }>>();

jest.mock('#src/commit/index.ts', () => ({
	...jest.requireActual<typeof import('#src/commit/index.ts')>('#src/commit/index.ts'),
	commitTicketWork: (params: CommitCall) => mockCommitTicketWork(params),
}));
// -------------------------

/** What the commit primitive was handed, restated here because a `jest.mock` factory may not reach outside the file. */
interface CommitCall {
	cwd: string;
	message: string;
	runDir: string;
	generated?: string[];
	onProgress?: (message: string) => void;
}

const setupLeftoverCommit = ({ runId }: { runId?: string } = {}) => {
	mockCommitTicketWork.mockResolvedValue({ committed: true });

	const plan = planOf({
		id: '001-search-index',
		title: 'Search index',
		progress: PlanProgress.Implemented,
		runId,
		finishedAt: '2026-01-03T00:00:00.000Z',
	});
	const record: WorkOrderState = {
		schemaVersion: 1,
		ticketRef: ticket.identifier,
		branch: ticketBranch,
		mode: WorkOrderMode.MultiplePlan,
		plans: [plan],
		history: [],
	};
	const step: WorkOrderPlanStep = {
		cwd: `/tmp/${ticketBranch}`,
		record,
		plan,
		ticket,
		config,
		env: {},
		driver,
		driverName: driver.name,
		workOrderRunDir: `/tmp/${ticketBranch}/.lightsout/runs/run-1/ticket`,
	};

	return { step };
};

describe('commitPlanWork', () => {
	test("carries the owning plan's run id in the commit body", async () => {
		const { step } = setupLeftoverCommit({ runId: 'run-1' });

		const refusal = await commitPlanWork({ step });

		const [subject, blank, ...body] = (mockCommitTicketWork.mock.calls[0]?.[0].message ?? '').split('\n');

		expect({ refusal, subject, blank, body: body.join('\n') }).toEqual({
			refusal: undefined,
			subject: 'LO-7 001-search-index: Search index',
			blank: '',
			body: expect.stringContaining('run-1'),
		});
	});

	test('commits under the subject alone when no run is recorded against the plan', async () => {
		const { step } = setupLeftoverCommit();

		const refusal = await commitPlanWork({ step });

		// A plan the record names no run for has nothing to put in a body, so the
		// message is the subject and nothing else — never a body naming no run.
		expect({ refusal, message: mockCommitTicketWork.mock.calls[0]?.[0].message }).toStrictEqual({
			refusal: undefined,
			message: 'LO-7 001-search-index: Search index',
		});
	});
});
