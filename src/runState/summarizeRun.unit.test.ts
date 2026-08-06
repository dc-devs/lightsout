import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runImplementPipeline } from '@/pipeline';
import { summarizeRun } from '@/runState';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

const usage = {
	inputTokens: 10,
	outputTokens: 100,
	cacheReadTokens: 880,
	cacheCreationTokens: 110,
	costUsd: 0.5,
};

test('summarizeRun aggregates step durations, per-step usage, files, gates, and friction', async () => {
	const dir = setupConsumerRepo();

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'write-tests') {
				writeFileSync(join(dir, 'test.feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test.feature.test.js', summary: 'tests' }] }), exitCode: 0, usage };
			}

			if (role === 'refactor') {
				return {
					text: report({ friction: [{ kind: 'decision', area: 'plan', detail: 'guessed a boundary' }] }),
					exitCode: 0,
					usage,
				};
			}

			writeFileSync(join(dir, 'src/feature.js'), 'export const feature = () => 2;\n');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0, usage };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const result = await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

	expect(result.ok).toBe(true);

	const summary = await summarizeRun({ cwd: dir, manifest: result.manifest });

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
	expect(writeTests?.invocations).toBe(1);

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
	const summary = await summarizeRun({
		cwd: '/nonexistent',
		manifest: {
			runId: 'ghost',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'failed',
			currentStep: null,
			steps: [{ id: 'clean-slate', status: 'failed', attempts: 1 }],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

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

/** Write the run's persisted evidence directly — the summary is a view over exactly these files. */
const plantEvidence = ({ cwd, runId, agents = [], commands = [], agentFiles = [], friction = [] }: PlantParams) => {
	const runDir = join(cwd, '.lightsout', 'runs', runId);

	mkdirSync(join(runDir, 'agents'), { recursive: true });
	writeFileSync(join(runDir, 'agents.jsonl'), agents.map((line) => `${line}\n`).join(''), 'utf8');
	writeFileSync(join(runDir, 'commands.jsonl'), commands.map((record) => `${JSON.stringify(record)}\n`).join(''), 'utf8');

	for (const name of agentFiles) {
		writeFileSync(join(runDir, 'agents', name), 'stub\n', 'utf8');
	}

	writeFileSync(join(cwd, '.lightsout', 'friction.jsonl'), friction.map((record) => `${JSON.stringify(record)}\n`).join(''), 'utf8');
};

interface PlantParams {
	cwd: string;
	runId: string;
	/** Raw agents.jsonl lines — malformed ones included, to pin ledger tolerance. */
	agents?: string[];
	commands?: Record<string, unknown>[];
	/** File names inside the run's `agents/` directory. */
	agentFiles?: string[];
	friction?: Record<string, unknown>[];
}

test('summarizeRun attributes supervisor consultations to the step they supervised', async () => {
	const cwd = setupConsumerRepo({ git: false });

	plantEvidence({
		cwd,
		runId: 'run-summary',
		agents: [
			JSON.stringify({ step: 'implement', outputTokens: 100, costUsd: 0.5 }),
			JSON.stringify({ step: 'implement-supervisor', outputTokens: 20, costUsd: 0.25 }),
			JSON.stringify({ step: 'write-tests', outputTokens: 8, costUsd: 0.125 }),
		],
	});

	const summary = await summarizeRun({
		cwd,
		manifest: {
			runId: 'run-summary',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'passed',
			currentStep: null,
			steps: [
				{ id: 'implement', status: 'passed', attempts: 1, durationMs: 1_000 },
				{ id: 'write-tests', status: 'passed', attempts: 1, durationMs: 500 },
			],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

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
	const cwd = setupConsumerRepo({ git: false });

	plantEvidence({
		cwd,
		runId: 'run-gates',
		commands: [
			{ durationMs: 100 },
			{ durationMs: 50, rerun: true },
			{ skipped: true },
			{ durationMs: 25, skipped: true },
		],
	});

	const summary = await summarizeRun({
		cwd,
		manifest: {
			runId: 'run-gates',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'passed',
			currentStep: null,
			steps: [],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

	expect(summary.gates).toStrictEqual({ commands: 2, reruns: 1, skipped: 2 });
	// every recorded duration counts toward gate time
	expect(summary.gateMs).toBe(175);
});

test('summarizeRun counts the rejected reports that cost a re-emit retry', async () => {
	const cwd = setupConsumerRepo({ git: false });

	plantEvidence({
		cwd,
		runId: 'run-rejected',
		agentFiles: ['rejected-implement-1.txt', 'rejected-write-tests-1.txt', 'implement-1.txt'],
	});

	const summary = await summarizeRun({
		cwd,
		manifest: {
			runId: 'run-rejected',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'passed',
			currentStep: null,
			steps: [],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

	// accepted transcripts are not retries
	expect(summary.rejectedReports).toBe(2);
});

test('summarizeRun counts only this run friction, not the repo accumulated history', async () => {
	const cwd = setupConsumerRepo({ git: false });
	const entry = (overrides: Record<string, unknown>) => ({
		kind: 'friction',
		area: 'plan',
		detail: 'something fought the agent',
		at: '2026-07-03T00:00:00.000Z',
		runId: 'run-friction',
		step: 'implement',
		...overrides,
	});

	plantEvidence({
		cwd,
		runId: 'run-friction',
		friction: [entry({}), entry({ step: 'write-tests' }), entry({ area: 'prompt' }), entry({ runId: 'an-older-run', area: 'environment' })],
	});

	const summary = await summarizeRun({
		cwd,
		manifest: {
			runId: 'run-friction',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'passed',
			currentStep: null,
			steps: [],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

	expect(summary.frictionByArea).toStrictEqual([
		{ area: 'plan', count: 2 },
		{ area: 'prompt', count: 1 },
	]);
});

test('summarizeRun skips ledger lines it cannot trust instead of failing the report card', async () => {
	const cwd = setupConsumerRepo({ git: false });

	plantEvidence({
		cwd,
		runId: 'run-torn',
		agents: [
			JSON.stringify({ step: 'implement', outputTokens: 100, costUsd: 0.5 }),
			'{"step":"implement","outputTokens":',
			JSON.stringify({ step: 'implement', outputTokens: 'lots', costUsd: 0.5 }),
		],
	});

	const summary = await summarizeRun({
		cwd,
		manifest: {
			runId: 'run-torn',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'passed',
			currentStep: null,
			steps: [{ id: 'implement', status: 'passed', attempts: 1 }],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

	// a torn line bills nothing rather than guessing
	expect(summary.steps[0]?.invocations).toBe(1);
	expect(summary.steps[0]?.outputTokens).toBe(100);
});

test('summarizeRun reports no cache share for a run whose input tokens are all zero', async () => {
	const summary = await summarizeRun({
		cwd: '/nonexistent',
		manifest: {
			runId: 'run-zero',
			createdAt: '2026-07-03T00:00:00.000Z',
			updatedAt: '2026-07-03T00:10:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'passed',
			currentStep: null,
			steps: [],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
			usage: { invocations: 1, inputTokens: 0, outputTokens: 40, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 },
		},
	});

	// a share of nothing is not zero efficiency
	expect(summary.cacheReadShare).toBe(undefined);
	// the usage aggregate still passes through
	expect(summary.usage?.outputTokens).toBe(40);
});

test('summarizeRun clamps wall time for a manifest stamped out of order', async () => {
	const summary = await summarizeRun({
		cwd: '/nonexistent',
		manifest: {
			runId: 'run-clock',
			createdAt: '2026-07-03T00:10:00.000Z',
			updatedAt: '2026-07-03T00:00:00.000Z',
			plan: 'plan.md',
			harness: 'stub',
			status: 'passed',
			currentStep: null,
			steps: [],
			changedFiles: [],
			packages: [],
			baselineDirtyFiles: [],
		},
	});

	// a clock that ran backwards reports no time, never negative time
	expect(summary.wallMs).toBe(0);
});
