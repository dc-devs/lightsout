import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { exitAfterImplement } from '#src/cli/common/utils/exitAfterImplement.ts';
import { LightsoutConfig, PlanProgress, RunStatus, ShipStatus, TicketMode, type TicketPlan, type TicketRecord } from '#src/contracts/index.ts';
import { updateLocalTicketRecord } from '#src/ticket/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { manifestOf } from '#tests/helpers/setupResume.ts';

// Mocked Imports
// -------------------------
// The merge is the one step that would leave the machine, and what it does is
// pinned by the ship module's own tests. Here it stands in only so a case can
// see WHETHER the chain reached it and WHAT it was handed — the ticket guard
// above all, which is the record's say over the merge.
type RunShip = typeof import('#src/ship/index.ts').runShip;

const mockRunShip = jest.fn<RunShip>();

jest.mock('#src/ship/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ship/index.ts')>('#src/ship/index.ts'),
	runShip: (params: Parameters<RunShip>[0]) => mockRunShip(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch its plans implement on. */
const ticketBranch = 'lo-140-multi';
const firstPlan = '001-search-basics';
const secondPlan = '002-ranking';

const planOf = ({ id, progress = PlanProgress.Implemented }: { id: string; progress?: PlanProgress }): TicketPlan => ({
	id,
	title: id,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
});

/**
 * A passed run of one plan of a ticket that has a record, with the merge
 * doubled and the ticket's own record on disk in the checkout the run
 * happened in.
 *
 * No `ticket-tracker` block, so the record is local only and the Done write
 * that follows a merge is a no-op: these cases are about which passed runs
 * chain into a merge at all, not about what a tracker is told afterwards.
 */
const setupTicketChain = async ({
	mode = TicketMode.MultiplePlan,
	plans = [planOf({ id: firstPlan }), planOf({ id: secondPlan })],
	shipRequest,
	afterImplement = false,
	planId = secondPlan,
}: {
	mode?: TicketMode;
	plans?: TicketPlan[];
	/** The plan ids an approved ship request names. Omit for a ticket nobody has asked to ship. */
	shipRequest?: string[];
	afterImplement?: boolean;
	/** Which of the ticket's plans this run built. */
	planId?: string;
} = {}) => {
	const { cwd } = setupBranchRepo({ branch: ticketBranch });
	const captured = captureCommandOutput();
	const planFolder = join('.lightsout', 'tickets', ticketBranch, 'plans', planId);

	mkdirSync(join(cwd, planFolder), { recursive: true });
	writeFileSync(join(cwd, planFolder, 'plan.md'), '# Plan: the work this run built\n');

	await updateLocalTicketRecord({
		cwd,
		ticketBranch,
		change: (): TicketRecord => ({
			schemaVersion: 1,
			ticketRef: 'LO-140',
			branch: ticketBranch,
			mode,
			plans,
			history: [],
			...(shipRequest === undefined ? {} : { shipRequest: { planIds: shipRequest, requestedAt: '2026-01-02T00:00:00.000Z' } }),
		}),
	});

	mockRunShip.mockResolvedValue({ status: ShipStatus.Shipped, branch: ticketBranch, ticketRef: 'LO-140', mergeCommit: '0f1e2d3c', failingChecks: [] });

	const config = LightsoutConfig.parse({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ship: { 'after-implement': afterImplement } });
	const manifest = manifestOf({ status: RunStatus.Passed, branch: ticketBranch, plan: join(planFolder, 'plan.md') });

	return { config, cwd, result: { ok: true, manifest }, ...captured };
};

describe('exitAfterImplement ticket mode', () => {
	test('a passed multiple-plan run whose ship request is not satisfied prints why and exits 0 without shipping', async () => {
		const { config, cwd, result, logged, exitCodes } = await setupTicketChain({ afterImplement: true });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: false, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		// `ship.after-implement` is on, and a multiple-plan ticket ignores it: the
		// human declares the finish line with a ship request, and until one exists
		// the run says so rather than merging the branch
		expect(mockRunShip).not.toHaveBeenCalled();
		expect(logged.some((line) => line.includes(ticketBranch) && line.includes('ship request'))).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a passed multiple-plan run that satisfies its ship request chains into ship with the ticket guard', async () => {
		const { config, cwd, result, exitCodes } = await setupTicketChain({ shipRequest: [firstPlan, secondPlan] });

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: false, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		// nobody typed --ship and the config asks for nothing, yet the request made
		// before this implementation finished is carried out — and the merge is
		// handed the record's own say over it, to re-ask just before merging
		const handed = mockRunShip.mock.calls[0]?.[0];

		expect(mockRunShip).toHaveBeenCalledTimes(1);
		expect(handed).toEqual(
			expect.objectContaining({ ticketGuard: expect.objectContaining({ authorize: expect.any(Function), recordShipped: expect.any(Function) }) }),
		);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("a single-plan ticket's passed run chains only as --ship and after-implement say", async () => {
		const { config, cwd, result, logged, exitCodes } = await setupTicketChain({
			mode: TicketMode.SinglePlan,
			plans: [planOf({ id: firstPlan })],
			planId: firstPlan,
		});

		await expect(exitAfterImplement({ config, cwd, result, shipFlag: false, noShipFlag: false, env: {} })).rejects.toThrow(/process\.exit/);

		// nobody asked, so nothing ships — and a single-plan ticket has no ship
		// request to report, so the run says nothing about one
		expect(mockRunShip).not.toHaveBeenCalled();
		expect(logged.filter((line) => line.includes('ship request'))).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});
});
