import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import type { GateResult } from '#src/contracts/gates/GateResult.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import { BranchPhase } from '#src/contracts/queue/BranchPhase.ts';
import { ShipBlockReason } from '#src/contracts/ship/ShipBlockReason.ts';
import { ShipMergeMethod } from '#src/contracts/ship/ShipMergeMethod.ts';
import type { ShipResult } from '#src/contracts/ship/ShipResult.ts';
import { ShipStatus } from '#src/contracts/ship/ShipStatus.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import { readBranchState } from '#src/queue/branchState/readBranchState.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { WorkOrderRunOutcome } from '#src/queue/common/types/WorkOrderRunOutcome.ts';
import type { nameWaveWorkOrders } from '#src/queue/nameWaveWorkOrders.ts';
import { runQueue } from '#src/queue/runQueue.ts';
import type { ShipIntegration } from '#src/ship/common/types/ShipIntegration.ts';
import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { nameWaveLikeTemplate } from '#tests/helpers/nameWaveLikeTemplate.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
type TicketSummary = WorkOrderRunOutcome['ticket'];
type ListEligibleParams = { settings: QueueSettings; trackerSettings: TrackerSettings };
type SetTicketLabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean };
type ScanParkedParams = {
	cwd: string;
	defaultBranch: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	shipSettings: ShipSettings;
	onProgress?: (message: string) => void;
};
type RunGatesParams = {
	cwd: string;
	config: LightsoutConfig;
	coverage?: boolean;
	packages?: string[];
	includeRoot?: boolean;
	runId?: string;
	step?: string;
	failFast?: boolean;
	onGateResult?: (result: GateResult) => void;
	onProgress?: (message: string) => void;
};

const mockListEligibleTickets = jest.fn<(params: ListEligibleParams) => Promise<TicketSummary[] | QueueFailure>>();
const mockSetTicketLabel = jest.fn<(params: SetTicketLabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/ticketSelection/listEligibleTickets.ts', () => ({
	listEligibleTickets: (params: ListEligibleParams) => mockListEligibleTickets(params),
}));
jest.mock('#src/ticketTracker/listLabelNames.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
}));
jest.mock('#src/ticketTracker/setTicketLabel.ts', () => ({ setTicketLabel: (params: SetTicketLabelParams) => mockSetTicketLabel(params) }));
// -------------------------
const mockScanParkedWorktrees = jest.fn<(params: ScanParkedParams) => Promise<ParkedWork | QueueFailure>>();

jest.mock('#src/queue/worktrees/scanParkedWorktrees.ts', () => ({
	scanParkedWorktrees: (params: ScanParkedParams) => mockScanParkedWorktrees(params),
}));
// -------------------------
const mockRunGates = jest.fn<(params: RunGatesParams) => Promise<GateRunResult>>();

jest.mock('#src/gates/runGates.ts', () => ({ runGates: (params: RunGatesParams) => mockRunGates(params) }));
// -------------------------
// The forge merge is the one thing here that would leave the machine. Git, the
// worktree and the branch-state record all stay real, because what this file
// asserts is what the queue does around the merge.
const mockRunShip = jest.fn<(params: { cwd: string; integration: ShipIntegration }) => Promise<ShipResult>>();

jest.mock('#src/ship/runShip.ts', () => ({ runShip: (params: { cwd: string; integration: ShipIntegration }) => mockRunShip(params) }));
// -------------------------
// Naming a wave creates work orders, which reads the tracker and spawns a
// harness — the work order module's own job, with its own tests. These cases
// keep the label and branch the queue's template renders, so what they state
// about branches and worktrees is what the drain itself decides.
const mockNameWaveWorkOrders = jest.fn<typeof nameWaveWorkOrders>(nameWaveLikeTemplate());

jest.mock('#src/queue/nameWaveWorkOrders.ts', () => ({
	nameWaveWorkOrders: (params: Parameters<typeof mockNameWaveWorkOrders>[0]) => mockNameWaveWorkOrders(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const shipSettings: ShipSettings = {
	ticketPattern: /^(?<ticket>[a-z]+-\d+)/,
	pullRequestBody: '{ticket}',
	mergeMethod: ShipMergeMethod.Merge,
	afterImplement: false,
	preShip: undefined,
	allowNoCi: false,
};

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Structured gate result',
	url: 'https://linear.app/lightsout/issue/LO-70',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
};

const mockDriverInvoke = jest.fn<Driver['invoke']>();

const driver: Driver = { name: 'stub', invoke: mockDriverInvoke };

const relay: QuestionRelay = {
	ask: () => Promise.reject(new Error('the shipping-only fixture never asks a question')),
	createProgressSink: () => () => undefined,
	close: () => undefined,
};

const shippedResult: ShipResult = {
	status: ShipStatus.Shipped,
	branch: 'lo-70-structured-gate-result',
	ticketRef: 'lo-70',
	prNumber: 41,
	prUrl: 'https://forge.example/pull/41',
	prTitle: 'LO-70',
	mergeCommit: '0f1e2d3c',
	mergedAt: '2026-01-01T00:00:00.000Z',
	failingChecks: [],
};

/**
 * A parked worktree carrying committed work, handed to the drain as the scan's
 * one ready outcome — the shape this queue exists to ship without a worker.
 */
const setupQueueShipping = async ({ shipBlock }: { shipBlock?: { reason: ShipBlockReason; detail: string } } = {}) => {
	const { cwd } = setupBranchRepo();
	const branch = 'lo-70-structured-gate-result';
	const worktree = join(dirname(cwd), `${basename(cwd)}-worktrees`, branch);

	// The ship records this branch leaves are filed in the work order that claims
	// it, so the record comes before the tree.
	seedWorkOrderRecord({ cwd, name: branch, ticketRef: 'LO-70' });
	execFileSync('git', ['worktree', 'add', worktree, '-b', branch, 'origin/main'], { cwd, stdio: 'ignore' });
	writeFileSync(join(worktree, 'feature.ts'), 'export const feature = 1;\n');
	execFileSync('git', ['add', '-A'], { cwd: worktree, stdio: 'ignore' });
	execFileSync('git', ['commit', '-qm', 'feature'], { cwd: worktree, stdio: 'ignore' });

	mockDriverInvoke.mockResolvedValue({ text: '', exitCode: 0 });
	mockListEligibleTickets.mockResolvedValue([]);
	mockScanParkedWorktrees.mockResolvedValue({
		resumed: [],
		outcomes: [{ ticket, name: branch, branch, worktreePath: worktree, ready: true }],
		leftBehind: [],
		merged: [],
	} satisfies ParkedWork);
	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], timeouts: [], coordination: undefined });
	mockRunShip.mockResolvedValue(shipBlock === undefined ? shippedResult : { status: ShipStatus.Blocked, ...shipBlock, failingChecks: [] });
	mockSetTicketLabel.mockResolvedValue(undefined);

	const progress: string[] = [];
	const settings = queueSettingsFixture();

	return { cwd, branch, worktree, settings, progress };
};

/** The drain, run against the repo the fixture built. */
const drainQueue = ({ cwd, settings, progress }: { cwd: string; settings: QueueSettings; progress: string[] }) =>
	runQueue({
		cwd,
		settings,
		trackerSettings: trackerSettingsFixture(),
		shipSettings,
		config,
		env: {},
		driver,
		driverName: driver.name,
		relay,
		onProgress: (message) => progress.push(message),
	});

describe('runQueue', () => {
	test('merges a parked worktree that already holds committed work, without spending a worker on it', async () => {
		const { cwd, branch, worktree, settings, progress } = await setupQueueShipping();

		const result = await drainQueue({ cwd, settings, progress });

		expect(result).toEqual({ outcomes: [expect.objectContaining({ ticket, ready: true })], leftBehind: [] });
		expect(mockDriverInvoke).not.toHaveBeenCalled();
		expect(existsSync(worktree)).toBe(false);
		expect(await readBranchState({ cwd, branch })).toEqual(expect.objectContaining({ phase: BranchPhase.Merged }));
	});

	test('parks a ready branch when the shared ship sequence could not make its integration green', async () => {
		const { cwd, worktree, settings, progress } = await setupQueueShipping({
			shipBlock: { reason: ShipBlockReason.IntegrationGatesFailed, detail: 'tsc: 3 errors' },
		});

		const result = await drainQueue({ cwd, settings, progress });

		expect(result).toEqual({
			outcomes: [expect.objectContaining({ ticket, ready: false, error: 'integration-gates-failed: tsc: 3 errors' })],
			leftBehind: [],
		});
		// the gates ran inside the ship rather than here, and the worktree is left
		// where a human can read it
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(existsSync(worktree)).toBe(true);
		expect(progress).toContain('LO-70 · not shipped: integration-gates-failed: tsc: 3 errors');
	});

	test("hands the drain's own harness to the merge lane's integration step", async () => {
		const { cwd, settings, progress } = await setupQueueShipping();

		await drainQueue({ cwd, settings, progress });

		expect(mockRunShip).toHaveBeenCalledWith(expect.objectContaining({ integration: { config, driver } }));
	});
});
