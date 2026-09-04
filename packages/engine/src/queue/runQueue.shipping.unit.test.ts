import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { BranchPhase, type GateResult, type LightsoutConfig, ShipMergeMethod, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { ParkedWork } from '#src/queue/common/types/ParkedWork.ts';
import { type QuestionRelay, type QueueFailure, type QueueSettings, readBranchState, runQueue, type TicketRunOutcome } from '#src/queue/index.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
type TicketSummary = TicketRunOutcome['ticket'];
type ListEligibleParams = { settings: QueueSettings; trackerSettings: TrackerSettings };
type SetParkedLabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; parked: boolean };
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
const mockSetParkedLabel = jest.fn<(params: SetParkedLabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/listEligibleTickets.ts', () => ({
	listEligibleTickets: (params: ListEligibleParams) => mockListEligibleTickets(params),
}));
jest.mock('#src/ticketTracker/index.ts', () => ({
	listLabelNames: () =>
		Promise.resolve(['planning-needs-brainstorm', 'planning-needs-plan', 'planning-ready-auto-plan', 'planning-complete', 'planning-not-needed']),
	setParkedLabel: (params: SetParkedLabelParams) => mockSetParkedLabel(params),
}));
// -------------------------
const mockScanParkedWorktrees = jest.fn<(params: ScanParkedParams) => Promise<ParkedWork | QueueFailure>>();

jest.mock('#src/queue/scanParkedWorktrees.ts', () => ({
	scanParkedWorktrees: (params: ScanParkedParams) => mockScanParkedWorktrees(params),
}));
// -------------------------
const mockRunGates = jest.fn<(params: RunGatesParams) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({
	runGates: (params: RunGatesParams) => mockRunGates(params),
}));
// -------------------------
// The forge merge is the one thing here that would leave the machine. Git, the
// worktree and the branch-state record all stay real, because what this file
// asserts is what the queue does around the merge.
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	runShip: (params: { cwd: string }) => mockRunShip(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const shipSettings: ShipSettings = {
	ticketPattern: /^(?<ticket>[a-z]+-\d+)/,
	pullRequestBody: '{ticket}',
	mergeMethod: ShipMergeMethod.Merge,
	afterImplement: false,
	preShip: undefined,
};

const ticket: TicketSummary = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Structured gate result',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
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
const setupQueueShipping = async ({ gateError }: { gateError?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const branch = 'lo-70-structured-gate-result';
	const worktree = join(dirname(cwd), `${basename(cwd)}-worktrees`, branch);

	execFileSync('git', ['worktree', 'add', worktree, '-b', branch, 'origin/main'], { cwd, stdio: 'ignore' });
	writeFileSync(join(worktree, 'feature.ts'), 'export const feature = 1;\n');
	execFileSync('git', ['add', '-A'], { cwd: worktree, stdio: 'ignore' });
	execFileSync('git', ['commit', '-qm', 'feature'], { cwd: worktree, stdio: 'ignore' });

	mockDriverInvoke.mockResolvedValue({ text: '', exitCode: 0 });
	mockListEligibleTickets.mockResolvedValue([]);
	mockScanParkedWorktrees.mockResolvedValue({
		resumed: [],
		outcomes: [{ ticket, branch, worktreePath: worktree, ready: true }],
		leftBehind: [],
		merged: [],
	} satisfies ParkedWork);
	mockRunGates.mockResolvedValue({ error: gateError, failedFamilies: gateError === undefined ? [] : ['check'], crashes: [] });
	mockRunShip.mockResolvedValue(shippedResult);
	mockSetParkedLabel.mockResolvedValue(undefined);

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

	test('parks a ready branch when its post-rebase gate result carries an error', async () => {
		const { cwd, worktree, settings, progress } = await setupQueueShipping({ gateError: 'tsc: 3 errors' });

		const result = await drainQueue({ cwd, settings, progress });

		expect(result).toEqual({
			outcomes: [expect.objectContaining({ ticket, ready: false, error: 'tsc: 3 errors' })],
			leftBehind: [],
		});
		expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktree, coverage: true }));
		expect(progress).toContain('LO-70 · not shipped: tsc: 3 errors');
	});
});
