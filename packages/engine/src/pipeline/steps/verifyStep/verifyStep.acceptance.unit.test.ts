import { describe, expect, jest, test } from '@jest/globals';
import { type AcceptanceTestRecord, type GateResult, type LightsoutConfig, type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { verifyStep } from '#src/pipeline/steps/verifyStep/verifyStep.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';

// Mocked Imports
// -------------------------
// The gate run has its own tests and its own evidence rules. What is under
// test here is only what the checkpoint hands it, so the call is captured and
// the verdict is handed back directly.
interface GateParams {
	run: PipelineRun;
	coverage?: boolean;
	checkpoint: string;
	rows: { testFile: string; testName: string; gate: string }[];
	final?: boolean;
}

type GateOutcome = GateRunResult & { failures: GateResult[]; gates: GateResult[] };

const mockRunVerificationGates = jest.fn<(params: GateParams) => Promise<GateOutcome>>();

jest.mock('#src/pipeline/common/utils/runVerificationGates.ts', () => ({
	runVerificationGates: (params: GateParams) => mockRunVerificationGates(params),
}));
// -------------------------

/**
 * A PipelineRun stub carrying only what the verification step touches, with a
 * driver that throws: no agent may be spawned over a checkpoint whose gates
 * came back green.
 */
const setupAcceptanceRun = () => {
	mockRunVerificationGates.mockResolvedValue({ error: undefined, failedFamilies: [], crashes: [], failures: [], gates: [] });

	const manifest = { runId: 'run-1', steps: [], changedFiles: [], packages: [], acceptanceTests: [], approvedTests: [] } as unknown as RunManifest;
	const progress: string[] = [];

	const run = {
		cwd: '/tmp/lightsout-verify-step-acceptance',
		config: {} as unknown as LightsoutConfig,
		driver: createUncalledDriver({ reason: 'no agent may be spawned over a green checkpoint' }),
		current: () => manifest,
		progress: (message: string) => progress.push(message),
		parkMessage: () => 'run parked',
		nextRecord: ({ id }: { id: string }) => ({ id, status: RunStatus.Running, attempts: 1 }),
		setStep: async ({ record }: { record: StepRecord }) => {
			manifest.steps = [record];
		},
		stop: async ({ error }: { error: string }) => ({ ok: false as const, manifest, error }),
		invokeRole: async () => ({ ok: false as const, rateLimited: false, error: 'no fix agent should run' }),
		agentEventSink: () => () => {},
		persistRejected: () => async () => {},
		recordUsage: async () => {},
	};

	return { run: run as unknown as PipelineRun };
};

describe('verifyStep', () => {
	test('verifyStep: passes the acceptance rows and the final-checkpoint flag to the verification gates', async () => {
		const { run } = setupAcceptanceRun();
		const rows: AcceptanceTestRecord[] = [
			{
				criterion: 'every results file the gate wrote is merged',
				testFile: 'packages/engine/src/gates/testResults/readTestResults.unit.test.ts',
				testName: 'readTestResults: merges every results file',
				gate: 'test',
			},
			{
				criterion: 'a repository with no jest config is reported on rather than crashed on',
				testFile: 'packages/engine/src/doctor/checkJestReporter.unit.test.ts',
				testName: 'checkJestReporter: reports nothing when the repository has no jest config',
				gate: 'test-coverage',
			},
		];

		const escalation = await verifyStep({
			run,
			planContent: '# Plan',
			id: 'verify-refactor',
			coverage: true,
			acceptanceTests: () => rows,
			final: true,
			buildFix: () => ({ systemPrompt: 'fix the gates', prompt: 'fix the gates' }),
		})();

		// The rows and the final flag are what let the gate run prove that every
		// acceptance test actually executed: a checkpoint that dropped either one
		// would go green on gates alone, which is the failure this work removes.
		expect(mockRunVerificationGates).toHaveBeenCalledWith(expect.objectContaining({ checkpoint: 'verify-refactor', coverage: true, rows, final: true }));
		expect(escalation).toBeUndefined();
	});
});
