import { describe, expect, jest, test } from '@jest/globals';
import { type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { stopOnGateCoordination } from '#src/pipeline/common/utils/stopOnGateCoordination.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

// Mocked Imports
// -------------------------
// The hold is another module's entry point with its own tests: what is under
// test here is whether this stop takes one at all, and for which ticket.
interface HoldParams {
	cwd: string;
	config: LightsoutConfig;
	ticketRef: string | undefined;
	runId: string;
	worktreePath: string;
	reason: string;
}

const mockTakeGateHold = jest.fn<(params: HoldParams) => Promise<string | undefined>>();

jest.mock('#src/gates/index.ts', () => ({
	takeGateHold: (params: HoldParams) => mockTakeGateHold(params),
}));
// -------------------------
// Which ticket the checkout's branch carries is ship's answer, read through the
// repository's own ticket pattern — handed here directly rather than by making
// a git checkout for it.
interface BranchParams {
	config: LightsoutConfig;
	cwd: string;
}

const mockReadBranchTicketRef = jest.fn<(params: BranchParams) => Promise<string | undefined>>();

jest.mock('#src/ship/index.ts', () => ({
	readBranchTicketRef: (params: BranchParams) => mockReadBranchTicketRef(params),
}));
// -------------------------

const coordination = 'gates never started: run run-7 in /tmp/worktrees/lo-124 has held the machine for 31m, and this run waited its full 30m for it';

const worktreePath = '/tmp/lightsout-worktrees/lo-118';

/**
 * A PipelineRun stub carrying only what this stop touches: the manifest it
 * reads the run id from, the progress it prints, and a stop that is captured
 * rather than performed. `order` records the hold and the stop as they happen,
 * which is how the "hold first" half of the contract is observed.
 */
const setupCoordinationStop = ({ ticketRef }: { ticketRef: string | undefined }) => {
	const order: string[] = [];

	mockReadBranchTicketRef.mockResolvedValue(ticketRef);
	mockTakeGateHold.mockImplementation(async () => {
		order.push('hold');

		return undefined;
	});

	const manifest = {
		runId: 'run-9',
		steps: [],
		changedFiles: [],
		packages: [],
		baselineDirtyFiles: [],
		approvedTests: [],
		currentStep: null,
	} as unknown as RunManifest;
	const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

	const run = {
		cwd: worktreePath,
		config,
		current: () => manifest,
		progress: () => undefined,
		setStep: async ({ record }: { record: StepRecord }) => {
			manifest.steps = [record];
		},
		stop: async ({ record, status, error }: { record: StepRecord; status: RunStatus; error: string }) => {
			order.push('stop');
			manifest.steps = [{ ...record, status, error }];

			return { ok: false as const, manifest, error };
		},
	};

	const record: StepRecord = { id: 'verify', status: RunStatus.Running, attempts: 1 };

	return { run: run as unknown as PipelineRun, config, record, order, steps: () => manifest.steps };
};

describe('stopOnGateCoordination', () => {
	test("takes a hold for the branch's ticket, and none without one", async () => {
		const unticketed = setupCoordinationStop({ ticketRef: undefined });

		const unticketedResult = await stopOnGateCoordination({
			run: unticketed.run,
			stepId: 'verify',
			record: unticketed.record,
			coordination,
			error: 'no gate output',
		});

		expect(mockTakeGateHold).not.toHaveBeenCalled();
		expect(unticketedResult).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining(coordination) }));
		expect(unticketed.steps()).toEqual([expect.objectContaining({ id: 'verify', status: RunStatus.Escalated })]);

		const ticketed = setupCoordinationStop({ ticketRef: 'LO-118' });

		const ticketedResult = await stopOnGateCoordination({
			run: ticketed.run,
			stepId: 'verify',
			record: ticketed.record,
			coordination,
			error: 'no gate output',
		});

		expect(mockTakeGateHold).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: worktreePath,
				config: ticketed.config,
				ticketRef: 'LO-118',
				runId: 'run-9',
				worktreePath,
				reason: coordination,
			}),
		);
		expect(ticketed.order).toEqual(['hold', 'stop']);
		expect(ticketedResult).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining(coordination) }));
		expect(ticketed.steps()).toEqual([expect.objectContaining({ id: 'verify', status: RunStatus.Escalated })]);
	});
});
