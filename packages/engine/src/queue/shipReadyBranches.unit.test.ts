import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { type LightsoutConfig, ShipBlockReason, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { createTicketWorktree } from '#src/queue/createTicketWorktree.ts';
import { shipReadyBranches } from '#src/queue/shipReadyBranches.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The gates and the forge are other modules' entry points, each covered by its
// own tests. Git is real, because the rebase is the whole mechanism this step
// exists for — a stubbed one would prove nothing about conflicts.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
jest.mock('#src/ship/index.ts', () => ({ runShip: (params: { cwd: string }) => mockRunShip(params) }));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const shipSettings = shipSettingsFixture();

const shippedResult: ShipResult = {
	status: ShipStatus.Shipped,
	branch: 'lo-70-drain',
	ticketRef: 'lo-70',
	prNumber: 41,
	prUrl: 'https://forge.example/pull/41',
	prTitle: 'LO-70',
	mergeCommit: '0f1e2d3c',
	mergedAt: '2026-01-01T00:00:00.000Z',
	failingChecks: [],
};

const ticketOf = ({ number }: { number: number }): TicketSummary => ({
	id: `id-${number}`,
	identifier: `LO-${number}`,
	title: `Ticket ${number}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Direct,
	status: 'Ready to implement',
	unfinishedBlockers: [],
});

const author = '-c user.name=t -c user.email=t@t';

/** A main checkout with one ready ticket branch per number, each committed in its own worktree. */
const setupReadyBranches = async ({ numbers, content = 'export const value = 1;\n' }: { numbers: number[]; content?: string }) => {
	const { cwd } = setupBranchRepo();

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });

	const ready: TicketRunOutcome[] = [];

	for (const number of numbers) {
		const branch = `lo-${number}-drain`;
		const worktreePath = String(await createTicketWorktree({ cwd, branch, defaultBranch: 'main' }));

		writeFileSync(join(worktreePath, 'work.ts'), content);
		execSync(`git add -A && git ${author} commit -qm work`, { cwd: worktreePath, stdio: 'ignore' });
		ready.push({ ticket: ticketOf({ number }), branch, worktreePath, ready: true });
	}

	mockRunGates.mockResolvedValue({ error: undefined, failedFamilies: [] });
	mockRunShip.mockResolvedValue(shippedResult);

	return { cwd, ready };
};

/** Move the remote's default branch on, so a rebase has something to move onto. */
const advanceOrigin = ({ cwd, file, content }: { cwd: string; file: string; content: string }) => {
	writeFileSync(join(cwd, file), content);
	execSync(`git add -A && git ${author} commit -qm main-moved && git push -q origin main`, { cwd, stdio: 'ignore' });
};

describe('shipReadyBranches', () => {
	test('rebases, re-runs the gates, merges, and drops the worktree once the ticket has shipped', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70] });

		const shipped = await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready });

		expect(shipped).toStrictEqual(ready);
		expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ cwd: ready[0].worktreePath, coverage: true }));
		expect(existsSync(ready[0].worktreePath)).toBe(false);
	});

	test('re-runs the gates because the rebase moved the branch onto commits it has never been tested against', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70] });

		advanceOrigin({ cwd, file: 'other.ts', content: 'export const other = 2;\n' });
		await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready });

		expect(mockRunGates).toHaveBeenCalledTimes(1);
		expect(mockRunShip).toHaveBeenCalledTimes(1);
	});

	test('parks a branch that will not rebase, leaving its worktree for a human and never reaching the forge', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70], content: 'export const value = 1;\n' });

		advanceOrigin({ cwd, file: 'work.ts', content: 'export const value = 99;\n' });

		const shipped = await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready });

		expect(shipped).toEqual([expect.objectContaining({ ready: false, error: expect.stringContaining('would not rebase onto origin/main') })]);
		expect(mockRunShip).not.toHaveBeenCalled();
		expect(existsSync(ready[0].worktreePath)).toBe(true);
	});

	test('parks a branch whose gates came back red after the rebase, rather than merging what nothing vouches for', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70] });

		mockRunGates.mockResolvedValue({ error: 'tsc: 3 errors', failedFamilies: ['check'] });

		const shipped = await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready });

		expect(shipped).toEqual([expect.objectContaining({ ready: false, error: 'tsc: 3 errors' })]);
		expect(mockRunShip).not.toHaveBeenCalled();
	});

	test('parks a blocked ship carrying the forge’s own reason and detail, and keeps the worktree', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70] });

		mockRunShip.mockResolvedValue({
			status: ShipStatus.Blocked,
			reason: ShipBlockReason.ChecksFailed,
			detail: 'one or more checks finished red',
			failingChecks: ['unit'],
		});

		const shipped = await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready });

		expect(shipped).toEqual([expect.objectContaining({ ready: false, error: 'checks-failed: one or more checks finished red' })]);
		expect(existsSync(ready[0].worktreePath)).toBe(true);
	});

	test('parks a ticket whose worktree was deleted between the drain and the ship, rather than throwing on the missing directory', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70] });

		rmSync(ready[0].worktreePath, { recursive: true, force: true });

		const shipped = await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready });

		expect(shipped).toEqual([expect.objectContaining({ ready: false, error: 'git could not fetch origin: git did not answer' })]);
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(mockRunShip).not.toHaveBeenCalled();
	});

	test('merges one branch at a time in the order it was picked up, because every merge moves the default branch', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70, 71] });
		const order: string[] = [];

		mockRunShip.mockImplementation(({ cwd: worktreePath }) => {
			order.push(worktreePath);

			return Promise.resolve(shippedResult);
		});

		await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready });

		expect(order).toStrictEqual([ready[0].worktreePath, ready[1].worktreePath]);
	});

	test('announces every ticket it could not merge, so a parked branch is visible without reading the report', async () => {
		const { cwd, ready } = await setupReadyBranches({ numbers: [70] });
		const progress: string[] = [];

		mockRunGates.mockResolvedValue({ error: 'tsc: 3 errors', failedFamilies: ['check'] });
		await shipReadyBranches({ cwd, config, shipSettings, defaultBranch: 'main', env: {}, ready, onProgress: (message) => progress.push(message) });

		expect(progress).toEqual([expect.stringContaining('rebasing lo-70-drain'), expect.stringContaining('LO-70 · not shipped: tsc: 3 errors')]);
	});
});
