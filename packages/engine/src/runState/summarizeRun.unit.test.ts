import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { summarizeRun } from '#src/runState/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const usage = {
	inputTokens: 10,
	outputTokens: 100,
	cacheReadTokens: 880,
	cacheCreationTokens: 110,
	costUsd: 0.5,
};

const manifest = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId: 'run-summary',
	createdAt: '2026-07-03T00:00:00.000Z',
	updatedAt: '2026-07-03T00:10:00.000Z',
	plan: 'plan.md',
	harness: 'stub',
	status: RunStatus.Passed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	...overrides,
});

interface PlantParams {
	/** Raw agents.jsonl lines — malformed ones included, to pin ledger tolerance. */
	agents?: string[];
	commands?: Record<string, unknown>[];
	/** File names inside the run's `agents/` directory. */
	agentFiles?: string[];
	friction?: Record<string, unknown>[];
	/** Manifest fields the test turns on; everything else is the baseline shape. */
	overrides?: Partial<RunManifest>;
}

/** Write the run's persisted evidence directly — the summary is a view over exactly these files. */
const plantEvidence = ({ agents = [], commands = [], agentFiles = [], friction = [], overrides = {} }: PlantParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });
	const planted = manifest(overrides);
	const runDir = join(cwd, '.lightsout', 'runs', planted.runId);

	mkdirSync(join(runDir, 'agents'), { recursive: true });
	writeFileSync(join(runDir, 'agents.jsonl'), agents.map((line) => `${line}\n`).join(''), 'utf8');
	writeFileSync(join(runDir, 'commands.jsonl'), commands.map((record) => `${JSON.stringify(record)}\n`).join(''), 'utf8');

	for (const name of agentFiles) {
		writeFileSync(join(runDir, 'agents', name), 'stub\n', 'utf8');
	}

	writeFileSync(join(cwd, '.lightsout', 'friction.jsonl'), friction.map((record) => `${JSON.stringify(record)}\n`).join(''), 'utf8');

	return { cwd, manifest: planted };
};

/** Drive a whole implement run with a stub driver, so the summary reads evidence the pipeline itself wrote. */
const setupPipelineRun = async () => {
	const cwd = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writeFileSync(join(cwd, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0, usage };
			}

			if (role === 'refactor') {
				return {
					text: report({ friction: [{ kind: 'decision', area: 'plan', detail: 'guessed a boundary' }] }),
					exitCode: 0,
					usage,
				};
			}

			writeSource({ dir: cwd, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0, usage };
		},
	};

	const config = await readConfig({ cwd });
	const result = await runImplementPipeline({ cwd, planPath: 'plan.md', driver, config });

	return { cwd, result };
};

test('summarizeRun aggregates step durations, per-step usage, files, gates, and friction', async () => {
	const { cwd, result } = await setupPipelineRun();

	expect(result.ok).toBe(true);

	const summary = await summarizeRun({ cwd, manifest: result.manifest });

	expect(summary.wallMs >= 0).toBeTruthy();
	// active time summed from step durations
	expect(summary.activeMs > 0).toBeTruthy();
	// gate time measured from commands.jsonl
	expect(summary.gateMs > 0).toBeTruthy();
	expect(summary.gates.commands > 0).toBeTruthy();

	const byId = new Map(summary.steps.map((step) => [step.id, step]));
	const implement = byId.get('implement');
	const writeTests = byId.get('write-tests');
	const refactor = byId.get('refactor');
	const cleanSlate = byId.get('clean-slate');

	// implement duration stamped
	expect(typeof implement?.durationMs).toBe('number');
	expect(implement?.changedFiles).toStrictEqual(['src/feature.js']);
	expect(implement?.invocations).toBe(1);
	expect(implement?.outputTokens).toBe(100);
	expect(implement?.costUsd).toBe(0.5);

	expect(writeTests?.changedFiles).toStrictEqual(['test.feature.test.js']);
	// one writer per changed file: the module and the caller wiring it in
	expect(writeTests?.invocations).toBe(2);

	// The refactor loop reported zero changes on its first pass — attributed
	// as an explicit empty list, distinct from steps that never change files.
	expect(refactor?.changedFiles).toStrictEqual([]);
	expect(refactor?.invocations).toBe(1);

	// gate-only steps bill no agents
	expect(cleanSlate?.invocations).toBe(0);
	expect(cleanSlate?.changedFiles).toBe(undefined);

	expect(summary.cacheReadShare).toBe(0.88);
	expect(summary.rejectedReports).toBe(0);
	expect(summary.frictionByArea).toStrictEqual([{ area: 'plan', count: 1 }]);
});

test('summarizeRun tolerates a run dir with no ledger, no commands, no friction', async () => {
	const ghost = manifest({ runId: 'ghost', status: RunStatus.Failed, steps: [{ id: 'clean-slate', status: RunStatus.Failed, attempts: 1 }] });

	const summary = await summarizeRun({ cwd: '/nonexistent', manifest: ghost });

	expect(summary.wallMs).toBe(600_000);
	expect(summary.activeMs).toBe(0);
	expect(summary.gateMs).toBe(0);
	expect(summary.usage).toBe(undefined);
	expect(summary.cacheReadShare).toBe(undefined);
	expect(summary.gates.commands).toBe(0);
	expect(summary.rejectedReports).toBe(0);
	expect(summary.frictionByArea).toStrictEqual([]);
	expect(summary.steps).toStrictEqual([
		{ id: 'clean-slate', status: 'failed', attempts: 1, durationMs: undefined, changedFiles: undefined, invocations: 0, outputTokens: 0, costUsd: 0 },
	]);
});

test('summarizeRun attributes supervisor consultations to the step they supervised', async () => {
	const { cwd, manifest: planted } = plantEvidence({
		agents: [
			JSON.stringify({ step: 'implement', outputTokens: 100, costUsd: 0.5 }),
			JSON.stringify({ step: 'implement-supervisor', outputTokens: 20, costUsd: 0.25 }),
			JSON.stringify({ step: 'write-tests', outputTokens: 8, costUsd: 0.125 }),
		],
		overrides: {
			steps: [
				{ id: 'implement', status: RunStatus.Passed, attempts: 1, durationMs: 1_000 },
				{ id: 'write-tests', status: RunStatus.Passed, attempts: 1, durationMs: 500 },
			],
		},
	});

	const summary = await summarizeRun({ cwd, manifest: planted });

	const byId = new Map(summary.steps.map((step) => [step.id, step]));

	// the supervisor consultation bills to the step it supervised
	expect(byId.get('implement')?.invocations).toBe(2);
	expect(byId.get('implement')?.outputTokens).toBe(120);
	expect(byId.get('implement')?.costUsd).toBe(0.75);
	expect(byId.get('write-tests')?.invocations).toBe(1);
	expect(byId.get('write-tests')?.costUsd).toBe(0.125);
	expect(summary.activeMs).toBe(1_500);
});

test('summarizeRun separates gates that ran from re-runs and skips', async () => {
	const { cwd, manifest: planted } = plantEvidence({
		commands: [{ durationMs: 100 }, { durationMs: 50, rerun: true }, { skipped: true }, { durationMs: 25, skipped: true }],
	});

	const summary = await summarizeRun({ cwd, manifest: planted });

	expect(summary.gates).toStrictEqual({ commands: 2, reruns: 1, skipped: 2 });
	// every recorded duration counts toward gate time
	expect(summary.gateMs).toBe(175);
});

test('summarizeRun counts the rejected reports that cost a re-emit retry', async () => {
	const { cwd, manifest: planted } = plantEvidence({
		agentFiles: ['rejected-implement-1.txt', 'rejected-write-tests-1.txt', 'implement-1.txt'],
	});

	const summary = await summarizeRun({ cwd, manifest: planted });

	// accepted transcripts are not retries
	expect(summary.rejectedReports).toBe(2);
});

test('summarizeRun counts only this run friction, not the repo accumulated history', async () => {
	const entry = (overrides: Record<string, unknown>) => ({
		kind: 'friction',
		area: 'plan',
		detail: 'something fought the agent',
		at: '2026-07-03T00:00:00.000Z',
		runId: 'run-friction',
		step: 'implement',
		...overrides,
	});

	const { cwd, manifest: planted } = plantEvidence({
		friction: [entry({}), entry({ step: 'write-tests' }), entry({ area: 'prompt' }), entry({ runId: 'an-older-run', area: 'environment' })],
		overrides: { runId: 'run-friction' },
	});

	const summary = await summarizeRun({ cwd, manifest: planted });

	expect(summary.frictionByArea).toStrictEqual([
		{ area: 'plan', count: 2 },
		{ area: 'prompt', count: 1 },
	]);
});

test('summarizeRun skips ledger lines it cannot trust instead of failing the report card', async () => {
	const { cwd, manifest: planted } = plantEvidence({
		agents: [
			JSON.stringify({ step: 'implement', outputTokens: 100, costUsd: 0.5 }),
			'{"step":"implement","outputTokens":',
			JSON.stringify({ step: 'implement', outputTokens: 'lots', costUsd: 0.5 }),
		],
		overrides: { steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1 }] },
	});

	const summary = await summarizeRun({ cwd, manifest: planted });

	// a torn line bills nothing rather than guessing
	expect(summary.steps[0]?.invocations).toBe(1);
	expect(summary.steps[0]?.outputTokens).toBe(100);
});

test('summarizeRun reports no cache share for a run whose input tokens are all zero', async () => {
	const zeroInput = manifest({
		runId: 'run-zero',
		usage: { invocations: 1, inputTokens: 0, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
	});

	const summary = await summarizeRun({ cwd: '/nonexistent', manifest: zeroInput });

	// a share of nothing is not zero efficiency
	expect(summary.cacheReadShare).toBe(undefined);
	// the usage aggregate still passes through
	expect(summary.usage?.outputTokens).toBe(40);
});

test('summarizeRun clamps wall time for a manifest stamped out of order', async () => {
	const backwards = manifest({ runId: 'run-clock', createdAt: '2026-07-03T00:10:00.000Z', updatedAt: '2026-07-03T00:00:00.000Z' });

	const summary = await summarizeRun({ cwd: '/nonexistent', manifest: backwards });

	// a clock that ran backwards reports no time, never negative time
	expect(summary.wallMs).toBe(0);
});
