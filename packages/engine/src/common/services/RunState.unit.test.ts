import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { RunState } from '#src/common/services/RunState.ts';
import { type AgentUsage, type LightsoutConfig, type RunManifest, RunStatus, type RunUsage } from '#src/contracts/index.ts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

const manifestOf = ({ usage }: { usage?: RunUsage } = {}): RunManifest => ({
	runId: 'run-state-1',
	usage,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: '',
	pipeline: 'refactor',
	harness: 'stub',
	status: RunStatus.Running,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	ledgerTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

const setupRunState = ({
	onProgress,
	overrides = {},
	usage,
}: {
	onProgress?: (message: string) => void;
	overrides?: Partial<LightsoutConfig>;
	usage?: RunUsage;
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-state-'));

	mkdirSync(join(cwd, '.lightsout', 'runs', 'run-state-1'), { recursive: true });

	return {
		cwd,
		agentsLog: join(cwd, '.lightsout', 'runs', 'run-state-1', 'agents.jsonl'),
		progressLog: join(cwd, '.lightsout', 'runs', 'run-state-1', 'progress.jsonl'),
		run: new RunState({ cwd, config: { ...config, ...overrides }, manifest: manifestOf({ usage }), onProgress }),
	};
};

/**
 * The progress log once it holds `count` lines.
 *
 * The sink returns synchronously and chains its appends through a promise
 * tail, so the file lands a few ticks after the calls that filled it — polling
 * for the expected count is what keeps this from racing the tail.
 */
const readProgressLines = async ({ path, count }: { path: string; count: number }) => {
	const attemptCeiling = 50;

	for (let attempt = 0; attempt < attemptCeiling; attempt += 1) {
		const body = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
		const lines = body === '' ? [] : body.split('\n');

		if (lines.length >= count) {
			return lines.map((line): { at: string; message: string } => JSON.parse(line));
		}

		await new Promise((resolve) => setTimeout(resolve, 5));
	}

	throw new Error(`progress log never reached ${count} lines: ${path}`);
};

/** One invocation's spend, as a harness reports it. */
const spendOf = (): AgentUsage => ({ inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheCreationTokens: 1, costUsd: 0.5 });

/**
 * A run that has already paid for one invocation — the arrangement for what the
 * totals do on the next persisted write. `usage` seeds the manifest as a resume
 * would, so the spend it already carried is part of the arrangement too.
 */
const setupSpentRun = async ({ usage }: { usage?: RunUsage } = {}) => {
	const state = setupRunState({ usage });

	await state.run.recordUsage({ step: 'batch-01', usage: spendOf() });

	return state;
};

describe('RunState', () => {
	test('update persists the patch and rebinds the live manifest, so current() never serves a stale read', async () => {
		const { cwd, run } = setupRunState();

		await run.update({ patch: { status: RunStatus.Passed } });

		expect(run.current().status).toBe(RunStatus.Passed);
		// persisted before the next action — the crash-safety half of the contract
		const onDisk = JSON.parse(readFileSync(join(cwd, '.lightsout', 'runs', 'run-state-1', 'manifest.json'), 'utf8'));

		expect(onDisk.status).toBe(RunStatus.Passed);
	});

	test('setStep appends a new step, replaces a repeated id in place, and points currentStep at it', async () => {
		const { run } = setupRunState();

		await run.setStep({ record: { id: 'batch-01', status: RunStatus.Running, attempts: 1 } });
		await run.setStep({ record: { id: 'batch-01', status: RunStatus.Passed, attempts: 1 } });
		await run.setStep({ record: { id: 'batch-02', status: RunStatus.Running, attempts: 1 } });

		expect(run.current().steps.map((step) => [step.id, step.status])).toStrictEqual([
			['batch-01', RunStatus.Passed],
			['batch-02', RunStatus.Running],
		]);
		expect(run.current().currentStep).toBe('batch-02');
	});

	test('setStep writes the caller patch alongside the step, and the step it names beats a stale currentStep in that patch', async () => {
		const { cwd, run } = setupRunState();

		await run.setStep({
			record: { id: 'batch-01', status: RunStatus.Running, attempts: 1 },
			patch: { currentStep: 'batch-00', changedFiles: ['src/a.ts'] },
		});

		// one persisted write carries both, and the record is the authority on
		// which step the run is on — a caller cannot leave currentStep behind
		expect(run.current()).toEqual(expect.objectContaining({ currentStep: 'batch-01', changedFiles: ['src/a.ts'] }));
		const onDisk = JSON.parse(readFileSync(join(cwd, '.lightsout', 'runs', 'run-state-1', 'manifest.json'), 'utf8'));

		expect(onDisk).toEqual(
			expect.objectContaining({
				currentStep: 'batch-01',
				changedFiles: ['src/a.ts'],
				steps: [{ id: 'batch-01', status: RunStatus.Running, attempts: 1 }],
			}),
		);
	});

	test('progress forwards to the listener', () => {
		const messages: string[] = [];
		const { run } = setupRunState({ onProgress: (message) => messages.push(message) });

		run.progress('working');

		expect(messages).toStrictEqual(['working']);
	});

	test('a run with no listener leaves the manifest exactly as it was', () => {
		const { run } = setupRunState();
		const before = run.current();

		run.progress('unheard');

		// progress narrates the run, it never changes it — the manifest is not
		// rewritten and current() is not rebound, whoever is listening
		expect(run.current()).toBe(before);
	});

	test('progress persists every message to the run’s own log, in order, whether anyone is listening or not', async () => {
		const heard: string[] = [];
		const { progressLog, run } = setupRunState({ onProgress: (message) => heard.push(message) });

		run.progress('step implement');
		run.progress('step refactor — pass 1/3');

		const lines = await readProgressLines({ path: progressLog, count: 2 });

		// a detached run leaves no stdout to tail — the log is the only place the
		// `now` line can read what the run is doing
		expect(lines.map((line) => line.message)).toStrictEqual(['step implement', 'step refactor — pass 1/3']);
		expect(lines.every((line) => typeof line.at === 'string' && line.at !== '')).toBe(true);
		// and the in-memory listener still gets every message unchanged
		expect(heard).toStrictEqual(['step implement', 'step refactor — pass 1/3']);
	});

	test('the agent timeout reads the config, with the one-hour default when the config is silent', () => {
		const { cwd } = setupRunState();

		expect(new RunState({ cwd, config, manifest: manifestOf() }).agentTimeoutMs).toBe(60 * 60_000);
		expect(new RunState({ cwd, config: { ...config, timeouts: { 'agent-minutes': 5 } }, manifest: manifestOf() }).agentTimeoutMs).toBe(5 * 60_000);
	});

	test('recordUsage leaves a ledger line naming the step and the model and effort in force', async () => {
		const { agentsLog, run } = setupRunState({ overrides: { model: 'stub-model-1', effort: 'high' } });

		await run.recordUsage({ step: 'batch-01', usage: spendOf() });

		// runs spend the user's subscription — every spend leaves a line
		expect(JSON.parse(readFileSync(agentsLog, 'utf8').trim())).toEqual(
			expect.objectContaining({
				step: 'batch-01',
				model: 'stub-model-1',
				effort: 'high',
				inputTokens: 10,
				outputTokens: 4,
				cacheReadTokens: 2,
				cacheCreationTokens: 1,
				costUsd: 0.5,
			}),
		);
	});

	test('an invocation whose harness reported no usage leaves no ledger line, rather than a line of zeros', async () => {
		const { agentsLog, run } = setupRunState();

		await run.recordUsage({ step: 'batch-01' });

		// the engine records what it can prove and never estimates
		expect(existsSync(agentsLog)).toBe(false);
	});

	test('the next persisted write stamps the run spend into the manifest, on disk and in current()', async () => {
		const { cwd, run } = await setupSpentRun();

		await run.update({ patch: { status: RunStatus.Passed } });

		expect(run.current().usage).toStrictEqual({ invocations: 1, inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheCreationTokens: 1, costUsd: 0.5 });
		const onDisk = JSON.parse(readFileSync(join(cwd, '.lightsout', 'runs', 'run-state-1', 'manifest.json'), 'utf8'));

		expect(onDisk.usage).toStrictEqual({ invocations: 1, inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheCreationTokens: 1, costUsd: 0.5 });
	});

	test('a resumed run adds to the spend its manifest already carried instead of restarting the count', async () => {
		const { run } = await setupSpentRun({
			usage: { invocations: 2, inputTokens: 100, outputTokens: 40, cacheReadTokens: 20, cacheCreationTokens: 10, costUsd: 1.5 },
		});

		await run.update({ patch: {} });

		// totals survive the process boundary a resume crosses — a restarted count
		// would under-report what the run has already cost
		expect(run.current().usage).toStrictEqual({ invocations: 3, inputTokens: 110, outputTokens: 44, cacheReadTokens: 22, cacheCreationTokens: 11, costUsd: 2 });
	});
});
