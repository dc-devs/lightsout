import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, ShipBlockReason, type ShipResult, ShipStatus, WorktreeOwner } from '#src/contracts/index.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { createMainCheckoutSerializer } from '#src/queue/common/utils/createMainCheckoutSerializer.ts';
import { runDrainLanes } from '#src/queue/drainLanes/index.ts';
import { createWorktree } from '#src/worktree/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';
import { shipSettingsFixture } from '#tests/helpers/shipSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Mocked Imports
// -------------------------
// The ship lane runs for real here — `runDrainLanes.unit.test.ts` stubs the
// merge step to drive the lanes by hand, so these cases are what proves the
// drain and the real merge step agree about a branch that could not merge. Git
// and the worktree stay real; the shared ship sequence is the one thing that
// would leave the machine, and it is where the integrated gates now run.
const mockTakeGateHold = jest.fn<(params: { reason: string }) => Promise<string | undefined>>();

jest.mock('#src/gates/index.ts', () => ({
	takeGateHold: (params: { reason: string }) => mockTakeGateHold(params),
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

/**
 * A drain with one finished branch waiting in the ship lane and nothing to
 * build, so the only thing it does is merge — or refuse to.
 *
 * The block is driven through the shared ship sequence rather than the gates,
 * because integrating the default branch and re-running the gates belong to it
 * now: a merge that never got the machine reaches this lane as a blocked ship
 * carrying `integration-gates-unavailable`, not as a gate result.
 */
const setupCarriedBranch = async ({ reason, detail }: { reason: ShipBlockReason; detail: string }) => {
	const { cwd } = setupBranchRepo();
	const branch = 'lo-70-drain';
	const worktreePath = String(await createWorktree({ cwd, branch, startPoint: 'origin/main', owner: WorktreeOwner.Queue, reuseExisting: true }));

	writeRepoFile({ cwd: worktreePath, path: 'work.ts', content: 'export const value = 1;\n' });
	execSync(`git add -A && git ${author} commit -qm work`, { cwd: worktreePath, stdio: 'ignore' });

	mockTakeGateHold.mockResolvedValue(undefined);
	mockRunShip.mockResolvedValue({ status: ShipStatus.Blocked, branch, reason, detail, failingChecks: [] });

	const ticket = queueTicketFixture({ identifier: 'LO-70', id: 'id-LO-70', title: 'Ticket LO-70' });
	const progress: string[] = [];

	const params = {
		cwd,
		config,
		runId: 'drain-41',
		holds: {},
		shipIntegration: shipIntegrationFixture(),
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

/** How the drain reported the one branch it tried to merge, beside the fact a park promises: the worktree still there. */
const parkOf = ({ outcomes, worktreePath }: { outcomes: TicketRunOutcome[]; worktreePath: string }) => ({
	reported: outcomes.map((outcome) => ({ identifier: outcome.ticket.identifier, ready: outcome.ready, error: outcome.error })),
	holdsTaken: mockTakeGateHold.mock.calls.length,
	worktreeKept: existsSync(worktreePath),
});

describe('runDrainLanes', () => {
	test('parks a branch whose merge never got the machine, naming the machine and taking a hold so the next drain does not pick it straight back up', async () => {
		const drain = await setupCarriedBranch({
			reason: ShipBlockReason.IntegrationGatesUnavailable,
			detail: 'another run holds the machine: run drain-41 in /tmp/lo-71-other, held for 31m',
		});

		const report = await runDrainLanes(drain.params);

		expect(parkOf({ outcomes: report.outcomes, worktreePath: drain.worktreePath })).toStrictEqual({
			reported: [{ identifier: 'LO-70', ready: false, error: 'another run holds the machine: run drain-41 in /tmp/lo-71-other, held for 31m' }],
			holdsTaken: 1,
			worktreeKept: true,
		});
	});

	test('parks a branch whose merge gates ran and went red carrying the gate output, and takes no hold, so the coordination guard swallows no ordinary red', async () => {
		const drain = await setupCarriedBranch({ reason: ShipBlockReason.IntegrationGatesFailed, detail: 'tsc: 3 errors' });

		const report = await runDrainLanes(drain.params);

		expect(parkOf({ outcomes: report.outcomes, worktreePath: drain.worktreePath })).toStrictEqual({
			reported: [{ identifier: 'LO-70', ready: false, error: 'integration-gates-failed: tsc: 3 errors' }],
			holdsTaken: 0,
			worktreeKept: true,
		});
	});

	test('announces the branch it could not merge, so a park on a busy machine is visible without reading the report', async () => {
		const drain = await setupCarriedBranch({
			reason: ShipBlockReason.IntegrationGatesUnavailable,
			detail: 'another run holds the machine: run drain-41',
		});

		await runDrainLanes(drain.params);

		expect(drain.progress).toEqual(expect.arrayContaining([expect.stringContaining('LO-70 · not shipped: another run holds the machine')]));
	});
});
