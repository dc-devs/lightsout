import { describe, expect, jest, test } from '@jest/globals';
import { type GateResult, LightsoutConfig } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/common/types/GateRunResult.ts';
import type { GateSchedule } from '#src/gates/common/types/GateSchedule.ts';
import { runSelfCheck } from '#src/gates/index.ts';

// Mocked Imports
// -------------------------
// The gate runner has its own suites, including the one that pins when it
// answers a coordination reason. What is under test here is only what the
// self-check does with that answer, and what it asks the runner for — so the
// answer is handed back directly and the call is recorded.
interface GateParams {
	cwd: string;
	config: LightsoutConfig;
	coverage?: boolean;
	packages?: string[];
	includeRoot?: boolean;
	runId?: string;
	step?: string;
	schedule?: GateSchedule;
	waitForMachine?: boolean;
	onGateResult?: (result: GateResult) => void;
	onProgress?: (message: string) => void;
}

const mockRunGates = jest.fn<(params: GateParams) => Promise<GateRunResult>>();

jest.mock('#src/gates/runGates.ts', () => ({
	runGates: (params: GateParams) => mockRunGates(params),
}));
// -------------------------

/** What Phase 1's wait expiry hands back: who holds the machine, in which worktree, and for how long. */
const heldByAnotherRun = 'gates never started: run run-holder has held the machine for 30m in /tmp/worktrees/other';

/**
 * A repository whose root block configures the three gates a self-check
 * schedules, with the gate runner's whole answer supplied by the caller.
 *
 * The whole-repository form is used so the scope needs no git worktree at all:
 * what is under test is the trip from the gate runner's answer to the
 * self-check's ending, not how the scope was resolved.
 *
 * `observations` are handed to the runner's own callback before it answers,
 * which is the only way an ending that judged something can be arranged: a run
 * that observed nothing reads as every observation being a skip.
 */
const setupCoordination = ({ result, observations = [] }: { result: GateRunResult; observations?: GateResult[] }) => {
	mockRunGates.mockImplementation(async ({ onGateResult }) => {
		for (const observation of observations) {
			onGateResult?.(observation);
		}

		return result;
	});

	const config = LightsoutConfig.parse({
		gates: { check: 'true', test: 'true', 'test-coverage': false, build: 'true' },
	});

	return { cwd: '/tmp/lightsout-self-check', config };
};

describe('runSelfCheck', () => {
	test('runSelfCheck: a gate run that never got the machine ends on the coordination reason', async () => {
		const { cwd, config } = setupCoordination({
			// exactly the shape Phase 1 answers with: a red carrying no failed family
			// and no crash, whose cause is the machine rather than the code
			result: { error: heldByAnotherRun, failedFamilies: [], crashes: [], coordination: heldByAnotherRun },
		});

		const result = await runSelfCheck({
			cwd,
			config,
			coverage: false,
			wholeRepository: true,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// gates were scheduled and none of them was judged: the reason names
		// coordination and carries its detail, while the error a reader would take
		// as the change being red stays empty
		expect(result).toEqual(
			expect.objectContaining({
				reason: 'coordination',
				coordination: heldByAnotherRun,
				gateNames: ['check', 'test', 'build'],
				gates: [],
				error: undefined,
				crashes: [],
			}),
		);
	});

	test('runSelfCheck: asks the gates not to wait for the machine', async () => {
		const { cwd, config } = setupCoordination({
			result: { error: undefined, failedFamilies: [], crashes: [], coordination: undefined },
		});

		await runSelfCheck({
			cwd,
			config,
			coverage: false,
			wholeRepository: true,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// this check records no verdict anywhere and the engine's checkpoints stay
		// the only authority, so a busy machine ends it at once rather than holding
		// a paid agent session open for the full wait
		expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ waitForMachine: false }));
	});

	test('runSelfCheck: an ordinary red still ends on the ran reason, carrying no coordination reason', async () => {
		const { cwd, config } = setupCoordination({
			// a gate that executed and went red on the code: a failed family, and no
			// coordination reason for the guard above to catch
			result: { error: 'check failed (exit 1)', failedFamilies: ['check'], crashes: [], coordination: undefined },
			observations: [{ kind: 'check', group: 'root', command: 'true', exitCode: 1, outputTail: 'src/added.ts:1 unused import' }],
		});

		const result = await runSelfCheck({
			cwd,
			config,
			coverage: false,
			wholeRepository: true,
			runId: 'run-1',
			step: 'implement',
			onProgress: () => undefined,
		});

		// the coordination guard reads one member rather than matching on the error
		// string, so an ordinary red reaches the agent as its own failure to repair
		expect(result).toEqual(
			expect.objectContaining({
				reason: 'ran',
				error: 'check failed (exit 1)',
				coordination: undefined,
			}),
		);
	});
});
