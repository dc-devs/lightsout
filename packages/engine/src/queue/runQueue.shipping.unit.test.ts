import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type GateResult, type LightsoutConfig, ShipMergeMethod } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { type QuestionRelay, type QueueFailure, type QueueSettings, runQueue, type TicketRunOutcome } from '#src/queue/index.ts';
import type { ShipSettings } from '#src/ship/index.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
type TicketSummary = TicketRunOutcome['ticket'];
type ParkedWork = {
	resumed: TicketSummary[];
	outcomes: TicketRunOutcome[];
	leftBehind: { identifier: string; reason: string }[];
};
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
	route: 'direct',
	unfinishedBlockers: [],
};

const driver: Driver = {
	name: 'stub',
	invoke: () => Promise.resolve({ text: '', exitCode: 0 }),
};

const relay: QuestionRelay = {
	ask: () => Promise.reject(new Error('the shipping-only fixture never asks a question')),
	createProgressSink: () => () => undefined,
	close: () => undefined,
};

const setupQueueShipping = async () => {
	const { cwd } = setupBranchRepo();
	const branch = 'lo-70-structured-gate-result';
	const worktree = join(dirname(cwd), `${basename(cwd)}-worktrees`, branch);

	execFileSync('git', ['worktree', 'add', worktree, '-b', branch, 'origin/main'], { cwd, stdio: 'ignore' });
	writeFileSync(join(worktree, 'feature.ts'), 'export const feature = 1;\n');
	execFileSync('git', ['add', '-A'], { cwd: worktree, stdio: 'ignore' });
	execFileSync('git', ['commit', '-qm', 'feature'], { cwd: worktree, stdio: 'ignore' });

	mockListEligibleTickets.mockResolvedValue([]);
	mockScanParkedWorktrees.mockResolvedValue({
		resumed: [],
		outcomes: [{ ticket, branch, worktreePath: worktree, ready: true }],
		leftBehind: [],
	});
	mockRunGates.mockResolvedValue({ error: 'tsc: 3 errors', failedFamilies: ['check'] });
	mockSetParkedLabel.mockResolvedValue(undefined);

	const progress: string[] = [];
	const settings = queueSettingsFixture();

	return { cwd, worktree, settings, progress };
};

describe('runQueue', () => {
	test('parks a ready branch when its post-rebase gate result carries an error', async () => {
		const { cwd, worktree, settings, progress } = await setupQueueShipping();

		const result = await runQueue({
			cwd,
			settings,
			trackerSettings: trackerSettingsFixture(),
			shipSettings,
			config,
			driver,
			driverName: driver.name,
			relay,
			onProgress: (message) => progress.push(message),
		});

		expect(result).toEqual({
			outcomes: [expect.objectContaining({ ticket, ready: false, error: 'tsc: 3 errors' })],
			leftBehind: [],
		});
		expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktree, coverage: true }));
		expect(progress).toContain('LO-70 · not shipped: tsc: 3 errors');
	});
});
