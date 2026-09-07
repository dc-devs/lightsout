import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { selfCheckCommand } from '#src/cli/selfCheckCommand.ts';
import { type GateResult, type LightsoutConfig, PipelineKind, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { seedRunDir } from '#tests/helpers/seedRunDir.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The gate run is the gates module's own entry point, covered by its own tests.
// What this file owns is which checkpoint, coverage answer and scope each step
// resolves to, what the command prints, and how it ends. Run state on disk is
// real, because reading a live run's manifest without disturbing it is one of
// the behaviours under test. The command file is imported directly rather than
// through the CLI barrel: the barrel re-exports every other command, and each
// of those would then read this file's stubbed gates barrel.
interface SelfCheckParams {
	cwd: string;
	config: LightsoutConfig;
	coverage: boolean;
	checkpoint?: string;
	wholeRepository: boolean;
	runId: string;
	step: string;
	onProgress: (message: string) => void;
}

interface SelfCheckResult {
	reason: 'ran' | 'nothing-changed' | 'nothing-scheduled' | 'unavailable';
	gateNames: string[];
	gates: GateResult[];
	error: string | undefined;
	crashes: string[];
}

const mockRunSelfCheck = jest.fn<(params: SelfCheckParams) => Promise<SelfCheckResult>>();

jest.mock('#src/gates/index.ts', () => ({
	// The real constant, because the command narrows and keys on its members —
	// a stubbed copy would drift from the reasons the gate run actually returns.
	// Read through the module's own barrel, which is the only path a file
	// outside the gates may reach it by.
	SelfCheckReason: jest.requireActual<typeof import('#src/gates/index.ts')>('#src/gates/index.ts').SelfCheckReason,
	runSelfCheck: (params: SelfCheckParams) => mockRunSelfCheck(params),
}));
// -------------------------

const redGate: GateResult = { kind: 'check', group: 'api', command: 'pnpm check', exitCode: 1, outputTail: 'src/thing.ts:3 unused import' };
/** A red that left no output tail, a pass, and a scoped skip — the three entries the failure print must tell apart. */
const silentRedGate: GateResult = { kind: 'test', group: 'api', command: 'pnpm test --filter api', exitCode: 1 };
const passingGate: GateResult = { kind: 'build', group: 'root', command: 'pnpm build', exitCode: 0 };
const skippedGate: GateResult = { kind: 'check', group: 'web', command: 'pnpm lint', skipped: true, reason: 'no "check" script' };

/** One answer from the gate run, defaulting to a green run of one gate. */
const endingOf = ({
	reason,
	gateNames = ['check'],
	gates = [],
	error,
	crashes = [],
}: {
	reason: SelfCheckResult['reason'];
	gateNames?: string[];
	gates?: GateResult[];
	error?: string;
	crashes?: string[];
}): SelfCheckResult => ({ reason, gateNames, gates, error, crashes });

/**
 * A consumer repo holding one seeded run per step the case exercises, with the
 * gate run answering whatever the case queued. One capture and one repo for the
 * whole test, so a case comparing two steps reads both acts off one log.
 */
const setupSelfCheck = async ({
	steps,
	pipeline,
	results = steps.map(() => endingOf({ reason: 'ran' })),
	lockPid,
}: {
	/** The `currentStep` of each seeded run, in the order the test acts on them. `null` is a run with no step in flight. */
	steps: (string | null)[];
	pipeline?: PipelineKind;
	/** What the gate run answers, one per act. */
	results?: SelfCheckResult[];
	/** Plant the repo-wide run lock held by this pid — a live holder is what a lock-taking command refuses. */
	lockPid?: number;
}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();
	const runIds = steps.map((_, index) => `run-${index}`);

	for (const result of results) {
		mockRunSelfCheck.mockResolvedValueOnce(result);
	}

	for (const [index, step] of steps.entries()) {
		await seedRunDir({ cwd, manifest: { runId: runIds[index], pipeline, status: RunStatus.Running, currentStep: step } });
	}

	if (lockPid !== undefined) {
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: lockPid, runId: runIds[0], startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	const contexts: CommandContext[] = runIds.map((runId) => ({ flags: parseFlags({ args: ['--run', runId] }), rest: [], cwd }));

	return { contexts, cwd, runIds, ...captured };
};

/** A repo holding no runs at all, and a context naming a run id nothing on disk answers to. */
const setupMissingRun = () => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();
	const context: CommandContext = { flags: parseFlags({ args: ['--run', 'run-gone'] }), rest: [], cwd };

	return { context, ...captured };
};

describe('selfCheckCommand', () => {
	// Two acts, because the criterion is the contrast between the two steps: at
	// implement no unit tests exist yet, so coverage is red by construction and
	// the executor is not the role that fixes it.
	test('selfCheckCommand: leaves coverage out at the implement step and puts it in at the refactor step', async () => {
		const { contexts } = await setupSelfCheck({ steps: ['implement', 'refactor'] });

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);
		await expect(selfCheckCommand(contexts[1])).rejects.toThrow(/process\.exit/);

		expect(mockRunSelfCheck.mock.calls.map(([params]) => ({ step: params.step, coverage: params.coverage }))).toStrictEqual([
			{ step: 'implement', coverage: false },
			{ step: 'refactor', coverage: true },
		]);
	});

	test("selfCheckCommand: mirrors the direct pipeline's own gate pass over the whole tree with coverage on", async () => {
		const { contexts } = await setupSelfCheck({ steps: ['implement'], pipeline: PipelineKind.Direct });

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		// that pipeline names no checkpoints and runs the root block over the whole
		// tree with coverage on — a diff-scoped self-check would loop the agent
		// against different commands than the ones that judge it
		expect(mockRunSelfCheck).toHaveBeenCalledWith(expect.objectContaining({ checkpoint: undefined, coverage: true, wholeRepository: true }));
	});

	test('selfCheckCommand: prints that an unmapped step has no self-check, and exits 0 without running a gate', async () => {
		const { contexts, logged, exitCodes } = await setupSelfCheck({ steps: ['write-tests'], results: [] });

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		// a stray invocation must not read as a failure the agent then chases
		expect(mockRunSelfCheck).not.toHaveBeenCalled();
		expect(logged.join('\n')).toMatch(/no self-check/i);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("selfCheckCommand: exits 1 on a red gate and 0 on a green one, and names the engine's gates as the only verdict either way", async () => {
		const { contexts, logged, exitCodes } = await setupSelfCheck({
			steps: ['implement', 'implement'],
			results: [endingOf({ reason: 'ran', error: 'check failed in [api]: exit 1', gates: [redGate] }), endingOf({ reason: 'ran' })],
		});

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);
		await expect(selfCheckCommand(contexts[1])).rejects.toThrow(/process\.exit/);

		// the red is shown as evidence about the code — the command that went red
		// and the output it left, which is what the agent repairs from
		expect(exitCodes).toStrictEqual([1, 0]);
		expect(logged.join('\n')).toContain('pnpm check');
		expect(logged.join('\n')).toContain('src/thing.ts:3 unused import');
		// and both endings hand the verdict back to the engine's own gates
		expect(logged.filter((line) => /verdict/i.test(line))).toHaveLength(2);
	});

	test("selfCheckCommand: reads a locked run's manifest without taking the run lock", async () => {
		const { contexts, cwd, exitCodes } = await setupSelfCheck({ steps: ['implement'], lockPid: process.pid });

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		// the run that spawned this agent holds the lock and is alive, so a
		// lock-taking command would refuse here rather than reach a gate at all
		expect(mockRunSelfCheck).toHaveBeenCalledTimes(1);
		expect(exitCodes).toStrictEqual([0]);
		expect(JSON.parse(readFileSync(join(cwd, '.lightsout', 'lock.json'), 'utf8'))).toStrictEqual({
			pid: process.pid,
			runId: 'run-0',
			startedAt: '2026-01-01T00:00:00.000Z',
		});
	});

	test('selfCheckCommand: maps a verify step to its own checkpoint, so a fix spawn re-runs the gate it is repairing', async () => {
		const { contexts } = await setupSelfCheck({ steps: ['verify-implement', 'verify-refactor'] });

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);
		await expect(selfCheckCommand(contexts[1])).rejects.toThrow(/process\.exit/);

		// a fix spawn re-running the gate it is repairing is where the second
		// repair spawn is saved
		expect(mockRunSelfCheck.mock.calls.map(([params]) => ({ checkpoint: params.checkpoint, coverage: params.coverage }))).toStrictEqual([
			{ checkpoint: 'verify-implement', coverage: false },
			{ checkpoint: 'verify-refactor', coverage: true },
		]);
	});

	test('selfCheckCommand: exits 0 without printing green for every ending that is not a red gate', async () => {
		const { contexts, logged, exitCodes } = await setupSelfCheck({
			steps: ['implement', 'implement', 'implement'],
			results: [
				endingOf({ reason: 'nothing-changed', gateNames: [] }),
				endingOf({ reason: 'nothing-scheduled', gateNames: [] }),
				endingOf({ reason: 'unavailable', gateNames: [] }),
			],
		});

		for (const context of contexts) {
			await expect(selfCheckCommand(context)).rejects.toThrow(/process\.exit/);
		}

		expect(exitCodes).toStrictEqual([0, 0, 0]);
		// none of the three says anything is wrong with the change, and none may
		// read as a check that passed either — the CLI's own green markers
		expect(logged.join('\n')).not.toMatch(/clean|✓/);
		expect(logged.filter((line) => /verdict/i.test(line))).toHaveLength(3);
	});

	test('selfCheckCommand: says in one line that a run id names no run on disk, and exits 1 without running a gate', async () => {
		const { context, errors, logged, exitCodes } = setupMissingRun();

		await expect(selfCheckCommand(context)).rejects.toThrow(/process\.exit/);

		// a stack trace in the agent's shell would spend one of its three rounds on
		// the tool rather than on the code
		expect(mockRunSelfCheck).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
		expect(errors.join('\n')).toContain("no run matching 'run-gone'");
		expect(logged).toStrictEqual([]);
	});

	// Each row reaches the no-self-check ending down a different branch of the
	// step lookup, so they are one behaviour with three ways in — a run between
	// steps, a pipeline this feature does not serve, and the direct pipeline's
	// other steps.
	test.each([
		{ label: 'a run with no step in flight', pipeline: undefined, step: null },
		{ label: 'the standalone refactor pipeline', pipeline: PipelineKind.Refactor, step: 'refactor' },
		{ label: "the direct pipeline's other steps", pipeline: PipelineKind.Direct, step: 'write-tests' },
	])('selfCheckCommand: gives $label no self-check, and exits 0 without running a gate', async ({ pipeline, step }) => {
		const { contexts, logged, exitCodes } = await setupSelfCheck({ steps: [step], pipeline, results: [] });

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		expect(mockRunSelfCheck).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
		expect(logged.join('\n')).toMatch(/no self-check/i);
	});

	test("selfCheckCommand: prints a crash as the engine's own failure, and leaves passing and skipped gates out of the evidence", async () => {
		const { contexts, logged, exitCodes } = await setupSelfCheck({
			steps: ['implement'],
			results: [
				endingOf({
					reason: 'ran',
					gateNames: ['check', 'test', 'build'],
					error: 'test failed in [api]: exit 1',
					gates: [passingGate, skippedGate, silentRedGate],
					crashes: ['jest worker crashed twice in [api]'],
				}),
			],
		});

		await expect(selfCheckCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		const output = logged.join('\n');

		// only the red is evidence about the code; a crash is the engine's own
		// failure, so the agent records it rather than spending a round on it
		expect(exitCodes).toStrictEqual([1]);
		expect(output).toContain('pnpm test --filter api');
		expect(output).toContain('engine: jest worker crashed twice in [api]');
		expect(output).not.toContain('pnpm build');
		expect(output).not.toContain('pnpm lint');
	});
});
