import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, type WorkOrderState, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runAutoPlanWorker } from '#src/queue/workers/runAutoPlanWorker.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

/**
 * What the worker does with a planning session that never produced a plan, and
 * what it hands the session before it starts.
 *
 * A sibling of `runAutoPlanWorker.unit.test.ts` rather than more cases in it:
 * that file states the plan's acceptance criteria and is written once, while
 * these are the ordinary cases that came across when the worker moved out of
 * `runWorkerWithRelay.ts` — each keeping the name and the assertion it carried
 * there. All of them read the harness call or a harness refusal, which is only
 * visible where the harness is mocked.
 */

// Mocked Imports
// -------------------------
/** The fields of the harness invocation these cases read; the real call carries more. */
interface InvokeCall {
	invocation: { prompt: string };
	timeoutMs?: number;
	allowedCommands?: string[];
}

const mockInvokeAgentWithContract = jest.fn<(params: InvokeCall) => Promise<AgentOutcome<WorkReport>>>();

jest.mock('#src/invoke/index.ts', () => ({
	invokeAgentWithContract: (params: InvokeCall) => mockInvokeAgentWithContract(params),
}));
// -------------------------
// The engine's choice of plan and the ordered build around the session are each
// covered by their own tests; stubbing them leaves the harness call these cases
// read as the only thing the worker does.
const mockChooseAutoPlanTarget = jest.fn<() => Promise<{ record: WorkOrderState; address?: string } | { error: string }>>();

jest.mock('#src/queue/workers/chooseAutoPlanTarget.ts', () => ({ chooseAutoPlanTarget: () => mockChooseAutoPlanTarget() }));
// -------------------------
const mockBuildTicketPlans = jest.fn<() => Promise<WorkerOutcome>>();

jest.mock('#src/queue/workers/buildWorkOrderPlans.ts', () => ({ buildWorkOrderPlans: () => mockBuildTicketPlans() }));
// -------------------------
const mockPullTicketRecord = jest.fn<() => Promise<{ record: WorkOrderState | undefined } | { error: string }>>();

jest.mock('#src/workOrder/index.ts', () => ({ pullWorkOrderState: () => mockPullTicketRecord() }));
// -------------------------

const branch = 'lo-70-drain';
const planId = '001-drain-the-backlog';
const address = `${branch}/${planId}`;

const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	url: 'https://linear.app/lightsout/issue/LO-70',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.ReadyAutoPlan,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
};

/** The work order's record, holding the one plan the engine handed the session. */
const record: WorkOrderState = {
	schemaVersion: 1,
	ticketRef: 'LO-70',
	branch,
	mode: 'multiple-plan',
	plans: [{ id: planId, title: 'Drain the backlog', progress: 'planning', createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [],
};

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'planned it',
	failures: [],
	...overrides,
});

/**
 * The worker's arguments against a real worktree holding the chosen plan's
 * folder, since the missing-folder guard reads the tree rather than a stub.
 *
 * `outcome` is what the harness hands back — a report, or the refusal that
 * means there is none — and `config` is the repository's own, which decides
 * what the session is allowed to run.
 */
const setupAutoPlanWorker = ({
	outcome = { ok: true, report: reportOf() },
	config = { gates: { check: 'true', test: 'true', 'test-coverage': false } },
}: {
	outcome?: AgentOutcome<WorkReport>;
	config?: LightsoutConfig;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-auto-plan-coverage-'));
	const folder = join(cwd, '.lightsout', 'tickets', branch, 'plans', planId);

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'plan.md'), '# The plan\n');

	mockChooseAutoPlanTarget.mockResolvedValue({ record, address });
	mockInvokeAgentWithContract.mockResolvedValue(outcome);
	mockPullTicketRecord.mockResolvedValue({ record });
	mockBuildTicketPlans.mockResolvedValue({});

	return {
		params: {
			cwd,
			ticket,
			branch,
			config,
			driver,
			driverName: 'claude-code',
			settings: queueSettingsFixture(),
			env: {},
			workOrderRunDir: join(cwd, '.lightsout', 'runs', 'run-q', 'tickets', 'LO-70'),
		},
	};
};

describe('runAutoPlanWorker', () => {
	test('gives the auto-plan session the ceiling the settings already carry, in milliseconds and unconverted', async () => {
		const { params } = setupAutoPlanWorker();

		await runAutoPlanWorker(params);

		expect(mockInvokeAgentWithContract.mock.calls[0]?.[0].timeoutMs).toBe(14_400_000);
	});

	test('parks an auto-plan worker whose report is neither a question nor success', async () => {
		const { params } = setupAutoPlanWorker({
			outcome: { ok: true, report: reportOf({ status: WorkReportStatus.Failed, failures: ['the lightsout plugin skills are not available'] }) },
		});

		const workerOutcome = await runAutoPlanWorker(params);

		expect(workerOutcome).toStrictEqual({ error: 'the lightsout plugin skills are not available' });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('parks a harness that refused outright, so a rate limit never reads as finished work', async () => {
		const { params } = setupAutoPlanWorker({ outcome: { ok: false, failure: 'harness rate limited or overloaded', rateLimited: true } });

		const workerOutcome = await runAutoPlanWorker(params);

		expect(workerOutcome).toStrictEqual({ error: 'harness rate limited or overloaded' });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('lets the session run the repository’s own agent commands, with the engine it is told to call appended', async () => {
		const { params } = setupAutoPlanWorker({
			config: { gates: { check: 'true', test: 'true', 'test-coverage': false }, 'agent-commands': ['gh issue view', 'git log'] },
		});

		await runAutoPlanWorker(params);

		// the engine grants itself last, so a repository that lists no commands
		// still reaches the subcommands the prompt tells the session to run
		expect(mockInvokeAgentWithContract.mock.calls[0]?.[0].allowedCommands).toStrictEqual(['gh issue view', 'git log', `node ${process.argv[1]}`]);
	});
});
