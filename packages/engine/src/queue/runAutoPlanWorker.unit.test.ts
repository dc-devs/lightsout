import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, type WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { AgentOutcome } from '#src/invoke/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runAutoPlanWorker } from '#src/queue/runAutoPlanWorker.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The planning session spawns a harness and the build spawns a pipeline, each
// covered by its own tests. What this file owns is the seam between them: what
// the session's report means, and whether the build is handed over at all. What
// the session is handed is read next door in the coverage sibling, so the
// harness stub here answers without being asked about its arguments.
const mockInvokeAgentWithContract = jest.fn<() => Promise<AgentOutcome<WorkReport>>>();
const mockRunPlanFolderPipeline = jest.fn<(params: { cwd: string; name: string }) => Promise<WorkerOutcome>>();

jest.mock('#src/invoke/index.ts', () => ({
	invokeAgentWithContract: () => mockInvokeAgentWithContract(),
}));
jest.mock('#src/queue/runPlanFolderPipeline.ts', () => ({
	runPlanFolderPipeline: (params: { cwd: string; name: string }) => mockRunPlanFolderPipeline(params),
}));
// -------------------------

const branch = 'lo-70-drain';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.ReadyAutoPlan,
	status: 'Ready to implement',
	unfinishedBlockers: [],
};

const reportOf = (overrides: Partial<WorkReport> = {}): WorkReport => ({
	status: WorkReportStatus.Complete,
	changedFiles: [],
	summary: 'planned it',
	failures: [],
	...overrides,
});

/**
 * The worker's arguments against a real worktree on disk, since the missing-folder
 * guard reads the tree rather than a stub.
 *
 * `report` is what the planning session hands back, and `build` is what the
 * engine-owned pipeline hands back once the folder is handed to it.
 */
const setupAutoPlanWorker = ({
	report = reportOf(),
	build = {},
	planFolder = true,
}: {
	report?: WorkReport;
	build?: WorkerOutcome;
	planFolder?: boolean;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-auto-plan-'));
	const folder = join(cwd, '.lightsout', 'plans', branch);

	if (planFolder) {
		mkdirSync(folder, { recursive: true });
		writeFileSync(join(folder, 'plan.md'), '# The plan\n');
	}

	mockInvokeAgentWithContract.mockResolvedValue({ ok: true, report });
	mockRunPlanFolderPipeline.mockResolvedValue(build);

	const progress: string[] = [];

	return {
		folder,
		progress,
		params: { cwd, ticket, branch, config, driver, settings: queueSettingsFixture(), onProgress: (message: string) => progress.push(message) },
	};
};

describe('runAutoPlanWorker', () => {
	test('the engine runs the build itself once the auto-plan session reports its plan complete', async () => {
		const { params } = setupAutoPlanWorker({ build: { error: 'tsc: 3 errors' } });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({ error: 'tsc: 3 errors' });
		expect(mockRunPlanFolderPipeline).toHaveBeenCalledWith(expect.objectContaining({ cwd: params.cwd, name: 'lo-70-drain' }));
	});

	test('parks an auto-plan ticket whose session reported a plan it never wrote, without building anything', async () => {
		const { params, folder } = setupAutoPlanWorker({ planFolder: false });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toEqual({ error: expect.stringContaining(folder) });
		expect(mockRunPlanFolderPipeline).not.toHaveBeenCalled();
	});

	test('announces on the progress stream that the engine is taking the build over', async () => {
		const { params, progress } = setupAutoPlanWorker();

		await runAutoPlanWorker(params);

		expect(progress).toContainEqual(expect.stringContaining('implement pipeline'));
	});

	test('starts no build for a turn the session ended by asking a question', async () => {
		const { params } = setupAutoPlanWorker({ report: reportOf({ status: WorkReportStatus.TerminatedAmbiguity, failures: ['Which one?'] }) });

		const outcome = await runAutoPlanWorker(params);

		expect(outcome).toStrictEqual({ question: 'Which one?' });
		expect(mockRunPlanFolderPipeline).not.toHaveBeenCalled();
	});
});
