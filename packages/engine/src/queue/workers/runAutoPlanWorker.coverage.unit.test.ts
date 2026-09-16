import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
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
const mockRunPlanningSession = jest.fn<typeof import('#src/queue/workers/runPlanningSession.ts').runPlanningSession>();
jest.mock('#src/queue/workers/runPlanningSession.ts', () => ({
	runPlanningSession: (params: Parameters<typeof mockRunPlanningSession>[0]) => mockRunPlanningSession(params),
}));
// -------------------------
// The engine's choice of plan and the ordered build around the session are each
// covered by their own tests; stubbing them leaves the harness call these cases
// read as the only thing the worker does.
const mockChooseAutoPlanTarget = jest.fn<() => Promise<{ record: TicketRecord; address?: string } | { error: string }>>();

jest.mock('#src/queue/workers/chooseAutoPlanTarget.ts', () => ({ chooseAutoPlanTarget: () => mockChooseAutoPlanTarget() }));
// -------------------------
const mockBuildTicketPlans = jest.fn<() => Promise<WorkerOutcome>>();

jest.mock('#src/queue/workers/buildTicketPlans.ts', () => ({ buildTicketPlans: () => mockBuildTicketPlans() }));
// -------------------------
const mockPullTicketRecord = jest.fn<() => Promise<{ record: TicketRecord | undefined } | { error: string }>>();

jest.mock('#src/ticket/index.ts', () => ({ pullTicketRecord: () => mockPullTicketRecord() }));
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

/** The ticket's record, holding the one plan the engine handed the session. */
const record: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-70',
	branch,
	mode: 'multiple-plan',
	plans: [{ id: planId, title: 'Drain the backlog', progress: 'planning', createdAt: '2026-01-01T00:00:00.000Z' }],
	history: [],
};

/**
 * The worker's arguments against a real worktree holding the chosen plan's
 * folder, since the missing-folder guard reads the tree rather than a stub.
 *
 * `outcome` is what the harness hands back — a report, or the refusal that
 * means there is none — and `config` is the repository's own, which decides
 * what the session is allowed to run.
 */
const setupAutoPlanWorker = ({
	outcome,
	config = { gates: { check: 'true', test: 'true', 'test-coverage': false } },
}: {
	outcome?: WorkerOutcome;
	config?: LightsoutConfig;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-auto-plan-coverage-'));
	const folder = join(cwd, '.lightsout', 'plans', branch, planId);

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'plan.md'), '# The plan\n');

	mockChooseAutoPlanTarget.mockResolvedValue({ record, address });
	mockRunPlanningSession.mockResolvedValue(outcome);
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
			ticketRunDir: join(cwd, '.lightsout', 'runs', 'run-q', 'tickets', 'LO-70'),
		},
	};
};

describe('runAutoPlanWorker', () => {
	test('passes the exact selected address and config to the typed planner without a session budget', async () => {
		const { params } = setupAutoPlanWorker();

		await runAutoPlanWorker(params);

		expect(mockRunPlanningSession).toHaveBeenCalledWith(expect.objectContaining({ planAddress: address, config: params.config }));
	});

	test('parks an auto-plan worker whose report is neither a question nor success', async () => {
		const { params } = setupAutoPlanWorker({
			outcome: { error: 'Required planning inputs are unavailable' },
		});

		const workerOutcome = await runAutoPlanWorker(params);

		expect(workerOutcome).toStrictEqual({ error: 'Required planning inputs are unavailable' });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('parks a harness that refused outright, so a rate limit never reads as finished work', async () => {
		const { params } = setupAutoPlanWorker({ outcome: { error: 'harness rate limited or overloaded' } });

		const workerOutcome = await runAutoPlanWorker(params);

		expect(workerOutcome).toStrictEqual({ error: 'harness rate limited or overloaded' });
		expect(mockBuildTicketPlans).not.toHaveBeenCalled();
	});

	test('preserves repository command configuration without granting a headless engine interpreter', async () => {
		const { params } = setupAutoPlanWorker({
			config: { gates: { check: 'true', test: 'true', 'test-coverage': false }, 'agent-commands': ['gh issue view', 'git log'] },
		});

		await runAutoPlanWorker(params);

		// the engine grants itself last, so a repository that lists no commands
		// still reaches the subcommands the prompt tells the session to run
		expect(mockRunPlanningSession.mock.calls[0]?.[0].config['agent-commands']).toEqual(['gh issue view', 'git log']);
	});
});
