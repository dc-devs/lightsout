import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, ShipBlockReason, type ShipResult, ShipStatus } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { createMainCheckoutSerializer } from '#src/queue/common/utils/createMainCheckoutSerializer.ts';
import { runDrainLanes } from '#src/queue/drainLanes/index.ts';
import { createTicketWorktree } from '#src/queue/worktrees/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// The ship lane runs for real here — `runDrainLanes.unit.test.ts` stubs the
// merge step to drive the lanes by hand, so these cases are what proves the
// drain and the real merge step agree about a branch that could not merge. Git
// and the worktree stay real, because the rebase is what the merge step exists
// for; the gates and the forge are the two things that would leave the machine.
const mockRunGates = jest.fn<(params: { cwd: string; coverage?: boolean }) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({
	runGates: (params: { cwd: string; coverage?: boolean }) => mockRunGates(params),
	// The hold has its own suite; here it only has to exist, because a park on a
	// busy machine now takes one on its way past.
	takeGateHold: () => Promise.resolve(undefined),
}));
// -------------------------
const mockRunShip = jest.fn<(params: { cwd: string }) => Promise<ShipResult>>();

jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	runShip: (params: { cwd: string }) => mockRunShip(params),
}));
// -------------------------

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const author = '-c user.name=t -c user.email=t@t';

/** Nothing is built in these cases: the branch arrives already finished, carried in from the parked scan. */
const runTicket = (): Promise<TicketRunOutcome> => Promise.reject(new Error('the drain started a build in a scenario that carries a finished branch'));

/** What the forge would answer if it were ever asked — arranged so a lane that wrongly merged is loud rather than silent. */
const blockedShip: ShipResult = {
	status: ShipStatus.Blocked,
	reason: ShipBlockReason.ChecksFailed,
	detail: 'the forge was reached in a case that must never reach it',
	failingChecks: [],
};

/**
 * A drain with one finished branch waiting in the ship lane and nothing to
 * build, so the only thing it does is merge — or refuse to.
 */
const setupCarriedBranch = async ({ error, coordination }: { error?: string; coordination?: string } = {}) => {
	const { cwd } = setupBranchRepo();
	const branch = 'lo-70-drain';
	const worktreePath = String(await createTicketWorktree({ cwd, branch, defaultBranch: 'main' }));

	writeRepoFile({ cwd: worktreePath, path: 'work.ts', content: 'export const value = 1;\n' });
	execSync(`git add -A && git ${author} commit -qm work`, { cwd: worktreePath, stdio: 'ignore' });

	// A coordination reason always arrives with an empty family list: no gate ran, so nothing about the code went red.
	const failedFamilies = error !== undefined && coordination === undefined ? ['test'] : [];

	mockRunGates.mockResolvedValue({ error, failedFamilies, crashes: [], coordination });
	mockRunShip.mockResolvedValue(blockedShip);

	const ticket = queueTicketFixture({ identifier: 'LO-70', id: 'id-LO-70', title: 'Ticket LO-70' });
	const progress: string[] = [];

	const params = {
		cwd,
		config,
		runId: 'drain-41',
		holds: {},
		settings: queueSettingsFixture(),
		trackerSettings: trackerSettingsFixture(),
		shipSettings: shipSettingsFixture(),
		defaultBranch: 'main',
		env: {},
		planPath: join(cwd, 'queue.md'),
		first: { runnable: [], blocked: [], skipped: [] },
		carried: [{ ticket, branch, worktreePath, ready: true }],
		attempted: new Set<string>(),
		runTicket,
		serializeMainCheckout: createMainCheckoutSerializer(),
		onProgress: (message: string) => progress.push(message),
	};

	return { params, progress, worktreePath };
};

/** How the drain reported the one branch it tried to merge, beside the two facts a park promises: the forge untouched and the worktree still there. */
const parkOf = ({ outcomes, worktreePath }: { outcomes: TicketRunOutcome[]; worktreePath: string }) => ({
	reported: outcomes.map((outcome) => ({ identifier: outcome.ticket.identifier, ready: outcome.ready, error: outcome.error })),
	forgeCalls: mockRunShip.mock.calls.length,
	worktreeKept: existsSync(worktreePath),
});

describe('runDrainLanes', () => {
	test('parks a branch whose merge gates never got the machine, naming the machine rather than the gate output beside it', async () => {
		const drain = await setupCarriedBranch({
			error: 'gate output nothing produced',
			coordination: 'another run holds the machine: run drain-41 in /tmp/lo-71-other, held for 31m',
		});

		const report = await runDrainLanes(drain.params);

		expect(parkOf({ outcomes: report.outcomes, worktreePath: drain.worktreePath })).toStrictEqual({
			reported: [{ identifier: 'LO-70', ready: false, error: 'another run holds the machine: run drain-41 in /tmp/lo-71-other, held for 31m' }],
			forgeCalls: 0,
			worktreeKept: true,
		});
	});

	test('parks a branch whose merge gates ran and went red carrying the gate output, so the coordination guard swallows no ordinary red', async () => {
		const drain = await setupCarriedBranch({ error: 'tsc: 3 errors' });

		const report = await runDrainLanes(drain.params);

		expect(parkOf({ outcomes: report.outcomes, worktreePath: drain.worktreePath })).toStrictEqual({
			reported: [{ identifier: 'LO-70', ready: false, error: 'tsc: 3 errors' }],
			forgeCalls: 0,
			worktreeKept: true,
		});
	});

	test('announces the branch it could not merge, so a park on a busy machine is visible without reading the report', async () => {
		const drain = await setupCarriedBranch({ error: 'gate output nothing produced', coordination: 'another run holds the machine: run drain-41' });

		await runDrainLanes(drain.params);

		expect(drain.progress).toEqual(expect.arrayContaining([expect.stringContaining('LO-70 · not shipped: another run holds the machine')]));
	});
});
