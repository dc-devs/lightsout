import { describe, expect, jest, test } from '@jest/globals';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { ShipStepFailure } from '#src/ship/common/types/ShipStepFailure.ts';
import { repairIntegratedGates } from '#src/ship/integration/repairIntegratedGates.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';
import { recordingDriver } from '#tests/helpers/recordingDriver.ts';
import { report } from '#tests/helpers/report.ts';
import { shipIntegrationFixture } from '#tests/helpers/shipIntegrationFixture.ts';

// Mocked Imports
// -------------------------
// The repository's own gates and its release hook are other modules' entry
// points, each covered by its own tests. The harness is NOT mocked: a scripted
// driver answers the real contract invoker, so what the repair attempt was
// handed is read off the invocation the harness received.
const mockRunGates = jest.fn<(params: { cwd: string }) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: { cwd: string }) => mockRunGates(params) }));
// -------------------------
const mockRunPreShip = jest.fn<(params: { cwd: string; command: string; baseCommit?: string }) => Promise<ShipStepFailure | undefined>>();

jest.mock('#src/ship/runPreShip.ts', () => ({
	runPreShip: (params: { cwd: string; command: string; baseCommit?: string }) => mockRunPreShip(params),
}));
// -------------------------

const green: GateRunResult = { error: undefined, failedFamilies: [], crashes: [] };

/** The exact commit the fetched default branch was pinned to — what preparation must be measured against on every pass. */
const baseCommit = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** A harness that answers every spawn with a complete WorkReport, recording what it was handed. */
const scriptedIntegrator = ({ invocations }: { invocations: DriverInvocation[] }): Driver =>
	recordingDriver({ driver: { name: 'stub', invoke: async () => ({ text: report(), exitCode: 0 }) }, invocations });

interface SetupParams {
	/** One entry per gate run, in order; the last entry answers every run after it. */
	gateRuns?: GateRunResult[];
	/** What the release hook reports, when the test is about a hook that failed. */
	preShipFailure?: ShipStepFailure;
	/** Drop the configured hook, for a repository that has none. */
	preShip?: string | undefined;
	/** Use a harness that must never be spawned, so a spawn the test denies is recorded and then loud. */
	uncalledDriver?: boolean;
}

const setupRepair = ({ gateRuns = [green], preShipFailure, preShip = 'pnpm run pre-ship', uncalledDriver = false }: SetupParams = {}) => {
	// One log across both stubs, because the claim under test is the ORDER —
	// prepared, then verified — which neither call count shows on its own.
	const order: string[] = [];
	const invocations: DriverInvocation[] = [];
	let gateRun = 0;

	mockRunPreShip.mockImplementation(async () => {
		order.push('pre-ship');

		return preShipFailure;
	});
	mockRunGates.mockImplementation(async () => {
		order.push('gates');
		const result = gateRuns[Math.min(gateRun, gateRuns.length - 1)] ?? green;
		gateRun += 1;

		return result;
	});

	const driver = uncalledDriver
		? recordingDriver({ driver: createUncalledDriver({ reason: 'a gate that crashed was handed to the integrator' }), invocations })
		: scriptedIntegrator({ invocations });

	const repair = () =>
		repairIntegratedGates({
			cwd: '/repo',
			integration: shipIntegrationFixture({ driver }),
			branch: 'lo-89-centralize-ship-integration',
			defaultBranch: 'main',
			standards: '# Standards',
			preShip,
			baseCommit,
		});

	return { invocations, order, repair };
};

describe('repairIntegratedGates', () => {
	// The ledger states one criterion, and so one test name, for both halves of
	// the hook contract: it runs against the pinned base before every gate pass,
	// and a hook that fails stops verification. Each half is arranged and acted
	// separately below.
	test('prepares each repaired tree against the same pinned base before verifying', async () => {
		const { order, repair } = setupRepair({ gateRuns: [{ error: 'test: 1 failing', failedFamilies: ['test'], crashes: [] }, green] });

		const settled = await repair();

		expect(settled).toBeUndefined();
		expect(order).toStrictEqual(['pre-ship', 'gates', 'pre-ship', 'gates']);
		expect(mockRunPreShip.mock.calls.map((call) => call[0])).toEqual([
			expect.objectContaining({ command: 'pnpm run pre-ship', baseCommit }),
			expect.objectContaining({ command: 'pnpm run pre-ship', baseCommit }),
		]);

		const failingHook = setupRepair({ preShipFailure: { stderr: 'plugin build failed: missing export' } });

		const blocked = await failingHook.repair();

		expect(blocked).toEqual(expect.objectContaining({ reason: 'pre-ship-failed', detail: expect.stringContaining('plugin build failed: missing export') }));
		expect(failingHook.order).toStrictEqual(['pre-ship']);
	});

	test("hands the failing gate's own output to the repair attempt", async () => {
		const { invocations, repair } = setupRepair({
			gateRuns: [{ error: 'test failed: expected 1, received 2', failedFamilies: ['test'], crashes: [] }, green],
		});

		const settled = await repair();

		expect(settled).toBeUndefined();
		expect(invocations.map((invocation) => invocation.prompt)).toEqual([expect.stringContaining('test failed: expected 1, received 2')]);
	});

	test('stops at the repair allowance and names the families that stayed red', async () => {
		const { invocations, repair } = setupRepair({
			gateRuns: [{ error: 'test: 3 failing\ncheck: 2 errors', failedFamilies: ['test', 'check'], crashes: [] }],
		});

		const settled = await repair();

		expect(settled).toEqual(
			expect.objectContaining({ reason: 'integration-gates-failed', paths: ['test', 'check'], detail: expect.stringContaining('test: 3 failing') }),
		);
		expect(invocations).toHaveLength(2);
		expect(mockRunGates).toHaveBeenCalledTimes(3);
	});

	test('attempts no repair for a gate that crashed instead of failing', async () => {
		const { invocations, repair } = setupRepair({
			gateRuns: [
				{ error: 'test: exited 139 with no verdict', failedFamilies: [], crashes: ['test: the known jest worker SIGSEGV, not a verdict about the code'] },
			],
			uncalledDriver: true,
		});

		const settled = await repair();

		expect(settled).toEqual(expect.objectContaining({ reason: 'integration-gates-failed', detail: expect.stringContaining('SIGSEGV') }));
		expect(invocations).toStrictEqual([]);
		expect(mockRunGates).toHaveBeenCalledTimes(1);
	});
});
