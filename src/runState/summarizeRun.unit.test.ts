import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
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

	assert.equal(result.ok, true);

	const summary = await summarizeRun({ cwd: dir, manifest: result.manifest });

	assert.ok(summary.wallMs >= 0);
	assert.ok(summary.activeMs > 0, 'active time summed from step durations');
	assert.ok(summary.gateMs > 0, 'gate time measured from commands.jsonl');
	assert.ok(summary.gates.commands > 0);

	const byId = new Map(summary.steps.map((step) => [step.id, step]));
	const implement = byId.get('implement');
	const writeTests = byId.get('write-tests');
	const refactor = byId.get('refactor');
	const cleanSlate = byId.get('clean-slate');

	assert.ok(implement && typeof implement.durationMs === 'number', 'implement duration stamped');
	assert.deepEqual(implement.changedFiles, ['src/feature.js']);
	assert.equal(implement.invocations, 1);
	assert.equal(implement.outputTokens, 100);
	assert.equal(implement.costUsd, 0.5);

	assert.deepEqual(writeTests?.changedFiles, ['test.feature.test.js']);
	assert.equal(writeTests?.invocations, 1);

	// The refactor loop reported zero changes on its first pass — attributed
	// as an explicit empty list, distinct from steps that never change files.
	assert.deepEqual(refactor?.changedFiles, []);
	assert.equal(refactor?.invocations, 1);

	assert.equal(cleanSlate?.invocations, 0, 'gate-only steps bill no agents');
	assert.equal(cleanSlate?.changedFiles, undefined);

	assert.equal(summary.cacheReadShare, 0.88);
	assert.equal(summary.rejectedReports, 0);
	assert.deepEqual(summary.frictionByArea, [{ area: 'plan', count: 1 }]);
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

	assert.equal(summary.wallMs, 600_000);
	assert.equal(summary.activeMs, 0);
	assert.equal(summary.gateMs, 0);
	assert.equal(summary.usage, undefined);
	assert.equal(summary.cacheReadShare, undefined);
	assert.equal(summary.gates.commands, 0);
	assert.equal(summary.rejectedReports, 0);
	assert.deepEqual(summary.frictionByArea, []);
	assert.deepEqual(summary.steps, [
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

	assert.equal(byId.get('implement')?.invocations, 2, 'the supervisor consultation bills to the step it supervised');
	assert.equal(byId.get('implement')?.outputTokens, 120);
	assert.equal(byId.get('implement')?.costUsd, 0.75);
	assert.equal(byId.get('write-tests')?.invocations, 1);
	assert.equal(byId.get('write-tests')?.costUsd, 0.125);
	assert.equal(summary.activeMs, 1_500);
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

	assert.deepEqual(summary.gates, { commands: 2, reruns: 1, skipped: 2 });
	assert.equal(summary.gateMs, 175, 'every recorded duration counts toward gate time');
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

	assert.equal(summary.rejectedReports, 2, 'accepted transcripts are not retries');
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

	assert.deepEqual(summary.frictionByArea, [
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

	assert.equal(summary.steps[0]?.invocations, 1, 'a torn line bills nothing rather than guessing');
	assert.equal(summary.steps[0]?.outputTokens, 100);
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

	assert.equal(summary.cacheReadShare, undefined, 'a share of nothing is not zero efficiency');
	assert.equal(summary.usage?.outputTokens, 40, 'the usage aggregate still passes through');
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

	assert.equal(summary.wallMs, 0, 'a clock that ran backwards reports no time, never negative time');
});
