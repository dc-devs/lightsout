import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderPlan } from '#src/contracts/workOrder/WorkOrderPlan.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { chooseAutoPlanTarget } from '#src/queue/workers/chooseAutoPlanTarget.ts';

// Mocked Imports
// -------------------------
// Reading the record and creating a plan belong to the ticket module, which
// tests both itself. What this file owns is the choice between them: which
// slug a first plan is asked for, which plan an existing record answers, and
// what an error does. The rule that names the next plan to plan is the real
// one, so the order it applies is pinned here rather than stubbed.
interface PullParams {
	cwd: string;
	name: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type PullResult = { record: WorkOrderState | undefined } | { error: string };

interface AddPlanParams {
	cwd: string;
	name: string;
	slug: string;
	title?: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type AddPlanResult = { address: string; record: WorkOrderState; notice?: string; publishError?: string } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullParams) => Promise<PullResult>>();
const mockAddTicketPlan = jest.fn<(params: AddPlanParams) => Promise<AddPlanResult>>();

jest.mock('#src/workOrder/index.ts', () => ({
	pullWorkOrderState: (params: PullParams) => mockPullTicketRecord(params),
	addWorkOrderPlan: (params: AddPlanParams) => mockAddTicketPlan(params),
	findNextPlanToPlan: jest.requireActual<typeof import('#src/workOrder/index.ts')>('#src/workOrder/index.ts').findNextPlanToPlan,
}));
// -------------------------

const branch = 'lo-140-multi';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const planWith = ({ id, progress, exclusion }: { id: string; progress: WorkOrderPlan['progress']; exclusion?: WorkOrderPlan['exclusion'] }): WorkOrderPlan => ({
	id,
	title: `Plan ${id}`,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	...(exclusion ? { exclusion } : {}),
});

const recordWith = ({ plans }: { plans: WorkOrderPlan[] }): WorkOrderState => ({
	schemaVersion: 1,
	name: branch,
	ticketRef: 'LO-140',
	branch,
	mode: 'multiple-plan',
	plans,
	history: [],
});

/** Two refusals the choice only passes along: one from the record pull, one from the plan creation. */
const divergenceError = 'the ticket record moved here and on LO-140: run lightsout work-order sync --name lo-140-multi';
const looseFilesError = 'lo-140-multi still holds loose files: run lightsout work-order add-plan --name lo-140-multi --slug <slug> --from lo-140-multi';

const ticketWith = ({ title }: { title: string }): TicketSummary => ({
	id: 'id-140',
	identifier: 'LO-140',
	title,
	url: 'https://linear.app/lightsout/issue/LO-140',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.ReadyAutoPlan,
	status: 'Backlog',
	finished: false,
	unfinishedBlockers: [],
});

/**
 * The choice's arguments, with the record the pull answers and the answer the
 * plan creation gives when the choice reaches for it.
 */
const setupChoice = ({
	pulled = { record: recordWith({ plans: [] }) },
	added = { error: 'addWorkOrderPlan was not expected to run' },
	title = 'Support multiple plans per ticket',
}: {
	pulled?: PullResult;
	added?: AddPlanResult;
	title?: string;
} = {}) => {
	mockPullTicketRecord.mockResolvedValue(pulled);
	mockAddTicketPlan.mockResolvedValue(added);

	const progress: string[] = [];

	return {
		params: {
			cwd: '/repo',
			workOrderName: branch,
			ticket: ticketWith({ title }),
			config,
			env: { LINEAR_API_KEY: 'key' } as NodeJS.ProcessEnv,
			onProgress: (message: string) => progress.push(message),
		},
	};
};

/**
 * A work order whose record stores a prefixed branch, so the label and the
 * branch are never the same string: every address built from the label parses,
 * and one built from the branch could not.
 */
const workOrderName = 'lo-140-multi-plan';

const prefixedBranch = 'feature/lo-140-multi-plan';

const labelledRecordWith = ({ plans }: { plans: WorkOrderPlan[] }): WorkOrderState => ({
	schemaVersion: 1,
	name: workOrderName,
	ticketRef: 'LO-140',
	branch: prefixedBranch,
	mode: 'multiple-plan',
	plans,
	history: [],
});

/**
 * The choice as it is asked for by label: the record the pull answers, and the
 * answer the plan creation gives when the choice reaches for it.
 */
const setupLabelledChoice = ({
	pulled,
	added = { error: 'addWorkOrderPlan was not expected to run' },
	title = 'Support multiple plans per ticket',
}: {
	pulled: PullResult;
	added?: AddPlanResult;
	title?: string;
}) => {
	mockPullTicketRecord.mockResolvedValue(pulled);
	mockAddTicketPlan.mockResolvedValue(added);

	const progress: string[] = [];

	return {
		params: {
			cwd: '/repo',
			workOrderName,
			ticket: ticketWith({ title }),
			config,
			env: { LINEAR_API_KEY: 'key' } as NodeJS.ProcessEnv,
			onProgress: (message: string) => progress.push(message),
		},
	};
};

describe('chooseAutoPlanTarget', () => {
	test('chooseAutoPlanTarget: a record holding no plans gets plan 001 slugged from the first three title words', async () => {
		const record = recordWith({ plans: [planWith({ id: '001-support-multiple-plans', progress: 'planning' })] });
		const { params } = setupChoice({ added: { address: `${branch}/001-support-multiple-plans`, record } });

		const answer = await chooseAutoPlanTarget(params);

		expect(answer).toEqual({ address: `${branch}/001-support-multiple-plans`, record });
		expect(mockAddTicketPlan).toHaveBeenCalledWith(
			expect.objectContaining({ name: branch, slug: 'support-multiple-plans', title: 'Support multiple plans per ticket' }),
		);
	});

	test('chooseAutoPlanTarget: a title that slugs to nothing gets the plan slug', async () => {
		const record = recordWith({ plans: [planWith({ id: '001-plan', progress: 'planning' })] });
		const { params } = setupChoice({ added: { address: `${branch}/001-plan`, record }, title: '!!! ***' });

		const answer = await chooseAutoPlanTarget(params);

		expect(answer).toEqual({ address: `${branch}/001-plan`, record });
		expect(mockAddTicketPlan).toHaveBeenCalledWith(expect.objectContaining({ slug: 'plan' }));
	});

	test('chooseAutoPlanTarget: a ticket with a record gets its lowest non-excluded plan still being planned', async () => {
		const record = recordWith({
			plans: [
				planWith({ id: '001-record', progress: 'implemented' }),
				planWith({
					id: '002-dropped',
					progress: 'planning',
					exclusion: { at: '2026-01-04T00:00:00.000Z', reason: 'folded into 003', implementationRemoved: false },
				}),
				planWith({ id: '003-queue-order', progress: 'planning' }),
				planWith({ id: '004-later', progress: 'planning' }),
			],
		});
		const { params } = setupChoice({ pulled: { record } });

		const answer = await chooseAutoPlanTarget(params);

		expect(answer).toEqual({ address: `${branch}/003-queue-order`, record });
		expect(mockAddTicketPlan).not.toHaveBeenCalled();
	});

	test('chooseAutoPlanTarget: a record with nothing waiting to be planned answers no address', async () => {
		const record = recordWith({
			plans: [planWith({ id: '001-record', progress: 'implemented' }), planWith({ id: '002-queue-order', progress: 'ready' })],
		});
		const { params } = setupChoice({ pulled: { record } });

		const answer = await chooseAutoPlanTarget(params);

		expect(answer).toEqual({ record });
		expect(mockAddTicketPlan).not.toHaveBeenCalled();
	});

	test('chooseAutoPlanTarget: a pull or add-plan error is the answer', async () => {
		const diverged = setupChoice({ pulled: { error: divergenceError } });

		const pullAnswer = await chooseAutoPlanTarget(diverged.params);

		expect(pullAnswer).toStrictEqual({ error: divergenceError });

		const refused = setupChoice({ added: { error: looseFilesError } });

		const addAnswer = await chooseAutoPlanTarget(refused.params);

		expect(addAnswer).toStrictEqual({ error: looseFilesError });
	});

	test('builds the plan address from the label, never from a prefixed branch', async () => {
		const record = labelledRecordWith({ plans: [planWith({ id: '003-queue-order', progress: 'planning' })] });
		const { params } = setupLabelledChoice({ pulled: { record } });

		const answer = await chooseAutoPlanTarget(params);

		const address = 'address' in answer ? answer.address : undefined;

		expect(answer).toEqual({ record, address: 'lo-140-multi-plan/003-queue-order' });
		expect(parsePlanAddress({ name: address ?? '' })).toEqual({ workOrderName: 'lo-140-multi-plan', planId: '003-queue-order' });
	});

	test('adds the first plan to a record that holds none, and answers its address', async () => {
		const planned = labelledRecordWith({ plans: [planWith({ id: '001-support-multiple-plans', progress: 'planning' })] });
		const { params } = setupLabelledChoice({
			pulled: { record: labelledRecordWith({ plans: [] }) },
			added: { address: 'lo-140-multi-plan/001-support-multiple-plans', record: planned },
		});

		const answer = await chooseAutoPlanTarget(params);

		expect(answer).toEqual({ record: planned, address: 'lo-140-multi-plan/001-support-multiple-plans' });
		expect(mockAddTicketPlan).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'lo-140-multi-plan', slug: 'support-multiple-plans', title: 'Support multiple plans per ticket' }),
		);
	});

	test('refuses a work order that has no record', async () => {
		const { params } = setupLabelledChoice({ pulled: { record: undefined } });

		const answer = await chooseAutoPlanTarget(params);

		expect(answer).toEqual({ error: expect.stringContaining('lo-140-multi-plan') });
		expect(mockAddTicketPlan).not.toHaveBeenCalled();
	});
});
