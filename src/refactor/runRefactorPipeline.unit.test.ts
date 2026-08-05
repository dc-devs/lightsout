import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RunManifest } from '@/contracts';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { readRunManifest } from '@/runState';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alpha = 1;\nexport const beta = 2;\n';

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

/** A driver whose refactor executor actually fixes a multi-export file by splitting it. */
const fixingDriver = ({ dir }: { dir: string }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		const target = prompt.match(/- (\S+\.ts)/)?.[1];

		if (target) {
			const beta = target.replace(/([^/]+)\.ts$/, 'beta.ts');

			writeFileSync(join(dir, target), 'export const alpha = 1;\n');
			writeFileSync(join(dir, beta), 'export const beta = 2;\n');

			return { text: report({ changedFiles: [{ path: target, summary: 'split' }, { path: beta, summary: 'split' }] }), exitCode: 0 };
		}

		return { text: report(), exitCode: 0 };
	},
});

/** A driver that judges every finding fine as-is: complete, zero changes. */
const decliningDriver: Driver = {
	name: 'stub',
	invoke: async () => ({
		text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'left as-is: exempt by design' }] }),
		exitCode: 0,
	}),
};

test('refactor: a batch the executor fixes is resolved, with a burn-down', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: fixingDriver({ dir }), config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, true, result.error);
	assert.equal(result.declined.length, 0);
	assert.equal(result.before['structure'], 1);
	assert.equal(result.after['structure'] ?? 0, 0, 'the multi-export finding burned down');

	const batch = result.manifest.steps.find((step) => step.id.startsWith('batch-'));

	assert.ok(batch?.id.includes('structure'), 'batch id names the detector');
	assert.equal(batch?.status, 'passed');
});

test('refactor: zero changes with persisting clusters is a decline — recorded, run still ok', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, true, result.error);
	assert.equal(result.declined.length, 1);
	assert.ok(result.declined[0]?.remainingClusters[0]?.startsWith('multi-export:'), 'the persisting cluster is named');
	assert.ok(result.declined[0]?.rationale[0]?.includes('left as-is'), "the agent's rationale rides along");
});

test('refactor: three consecutive declines stop the run as systemic', async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta', 'gamma']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, false);
	assert.match(result.error ?? '', /consecutive batches declined/);
	assert.equal(result.manifest.status, 'escalated');
	assert.equal(result.declined.length, 3);
});

test('refactor: a dirty tree is a hard error before any run state exists', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/uncommitted.ts'), 'export const later = 1;\n');

	await assert.rejects(
		runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await loadConfig({ cwd: dir }) }),
		/requires a clean tree/,
	);
});

test('refactor: a red pre-flight gate fails the run before any batch', async () => {
	const dir = setupConsumerRepo({ scripts: { check: 'false' } });

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	const invocations: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			invocations.push(prompt);

			return { text: report(), exitCode: 0 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, false);
	assert.match(result.error ?? '', /not green before refactoring/);
	assert.equal(invocations.length, 0, 'no agent was spawned against a red baseline');
});

test('refactor: an empty work-list completes as a verdict, spawning nothing', async () => {
	const dir = setupConsumerRepo();
	const invocations: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			invocations.push(prompt);

			return { text: report(), exitCode: 0 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, true, result.error);
	assert.equal(invocations.length, 0);
	assert.equal(result.manifest.status, 'passed');
});

test('refactor: a rate limit parks the run; resume finishes it', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	let calls = 0;
	const parkThenFix: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			calls += 1;

			if (calls === 1) {
				return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
			}

			return fixingDriver({ dir }).invoke(invocation);
		},
	};

	const config = await loadConfig({ cwd: dir });
	const parked = await runRefactorPipeline({ cwd: dir, driver: parkThenFix, config });

	assert.equal(parked.ok, false);
	assert.equal(parked.manifest.status, 'paused-rate-limit');

	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runRefactorPipeline({ cwd: dir, driver: parkThenFix, config, existing });

	assert.equal(resumed.ok, true, resumed.error);
	assert.equal(resumed.manifest.runId, parked.manifest.runId, 'resume continues the same run');
	assert.equal(resumed.after['structure'] ?? 0, 0);
});

test('refactor: --max-batches parks resumable at the budget ceiling', async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: fixingDriver({ dir }), config: await loadConfig({ cwd: dir }), maxBatches: 1 });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'paused-budget');
	assert.match(result.error ?? '', /--max-batches 1/);

	const passedBatches = result.manifest.steps.filter((step) => step.id.startsWith('batch-') && step.status === 'passed');

	assert.equal(passedBatches.length, 1, 'exactly one batch ran before the ceiling');
});

test('refactor: declines recorded before a park survive the resume (report, streak, and all)', async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	let betaCalls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			if (invocation.prompt.includes('alpha/multi.ts')) {
				return { text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'alpha left as-is' }] }), exitCode: 0 };
			}

			betaCalls += 1;

			if (betaCalls === 1) {
				return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
			}

			writeFileSync(join(dir, 'beta/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'beta/beta.ts'), 'export const beta = 2;\n');

			return { text: report({ changedFiles: [{ path: 'beta/multi.ts', summary: 'split' }, { path: 'beta/beta.ts', summary: 'split' }] }), exitCode: 0 };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const parked = await runRefactorPipeline({ cwd: dir, driver, config });

	assert.equal(parked.manifest.status, 'paused-rate-limit');
	assert.equal(parked.declined.length, 1, 'alpha declined before the park');

	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runRefactorPipeline({ cwd: dir, driver, config, existing });

	assert.equal(resumed.ok, true, resumed.error);
	assert.equal(resumed.declined.length, 1, "the pre-park decline survives the resume — it is the run's deliverable");
	assert.ok(resumed.declined[0]?.batchId.includes('alpha'));
	assert.ok(resumed.declined[0]?.rationale[0]?.includes('alpha left as-is'));
});

test('refactor: an implement-pipeline manifest is refused with a pointer to the right command', async () => {
	const dir = setupConsumerRepo();
	const config = await loadConfig({ cwd: dir });
	const implementManifest = RunManifest.parse({
		runId: 'not-a-refactor-run',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		plan: 'plan.md',
		pipeline: 'implement',
		harness: 'stub',
		status: 'failed',
		currentStep: null,
		steps: [],
		changedFiles: [],
		packages: [],
		baselineDirtyFiles: [],
	});

	await assert.rejects(
		runRefactorPipeline({ cwd: dir, driver: decliningDriver, config, existing: implementManifest }),
		/belongs to the implement pipeline/,
	);
});

test('refactor: terminated:scope is a decline that continues, not a run-ending escalation', async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			if (invocation.prompt.includes('alpha/multi.ts')) {
				return { text: report({ status: 'terminated:scope', failures: ['cannot be resolved in scope'] }), exitCode: 0 };
			}

			writeFileSync(join(dir, 'beta/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'beta/beta.ts'), 'export const beta = 2;\n');

			return { text: report({ changedFiles: [{ path: 'beta/multi.ts', summary: 'split' }, { path: 'beta/beta.ts', summary: 'split' }] }), exitCode: 0 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, true, `a scope refusal must not end the run: ${result.error}`);
	assert.equal(result.declined.length, 1, 'the scope refusal is recorded as a decline');
	assert.ok(result.declined[0]?.rationale.some((line) => line.includes('cannot be resolved in scope')), 'the refusal reason rides the decline');
	assert.equal(result.after['structure'] ?? 0, 1, 'the other batch still ran and resolved');
});

test('refactor: an invocation failure whose work is verifiably done is salvaged as resolved', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	// The laptop-sleep shape: the agent fixes the finding on disk, then dies
	// without ever producing a valid report (both contract attempts fail).
	const driver: Driver = {
		name: 'stub',
		invoke: async () => {
			writeFileSync(join(dir, 'src/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'src/beta.ts'), 'export const beta = 2;\n');

			return { text: 'no json here — the process died mid-report', exitCode: 1 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, true, `verified work must be salvaged, not failed: ${result.error}`);
	assert.equal(result.after['structure'] ?? 0, 0, 'the finding is gone');

	const batch = result.manifest.steps.find((step) => step.id.startsWith('batch-'));

	assert.ok(JSON.stringify(batch?.report).includes('salvaged'), 'the salvage is recorded honestly on the step');
});

test('refactor: advisories are recomputed at batch time, not served stale from the frozen worklist', async () => {
	const dir = setupConsumerRepo();

	linkTypescript({ dir });
	mkdirSync(join(dir, 'alpha'), { recursive: true });

	// The finding file ALSO carries a size advisory (an over-cap function), so
	// the advisory rides the batch as context for the same file.
	const bigFunction = `export const big = () => {\n${Array.from({ length: 85 }, (_, index) => `\tconst v${index} = ${index};`).join('\n')}\n\treturn v0;\n};\n`;

	writeFileSync(join(dir, 'alpha/multi.ts'), `export const alpha = 1;\n${bigFunction}`);
	commitAll(dir);

	let calls = 0;
	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			calls += 1;

			if (calls === 1) {
				return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
			}

			prompts.push(prompt);
			writeFileSync(join(dir, 'alpha/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'alpha/beta.ts'), 'export const beta = 2;\n');

			return { text: report({ changedFiles: [{ path: 'alpha/multi.ts', summary: 'split' }, { path: 'alpha/beta.ts', summary: 'split' }] }), exitCode: 0 };
		},
	};

	const config = await loadConfig({ cwd: dir });
	const parked = await runRefactorPipeline({ cwd: dir, driver, config });

	assert.equal(parked.manifest.status, 'paused-rate-limit');

	// Between park and resume, the advisory's location shifts — the frozen
	// worklist now cites stale lines.
	writeFileSync(join(dir, 'alpha/multi.ts'), `${'// shift\n'.repeat(10)}export const alpha = 1;\n${bigFunction}`);

	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runRefactorPipeline({ cwd: dir, driver, config, existing });

	assert.equal(resumed.ok, true, resumed.error);
	assert.ok(prompts[0]?.includes('alpha/multi.ts:12'), `the advisory in the prompt cites the LIVE line (12), not the frozen one (2) — got:\n${prompts[0]?.split('\n').filter((line) => line.includes('[size]')).join('\n')}`);
});

// v1.2 — supervisor consult on the red-gate exception path. The fixture's
// check gate fails while broken.flag exists; the executor's "fix" plants the
// flag, cheap fixes shrug, and only the supervisor-guided invocation removes it.
const supervisorFixture = () => {
	const dir = setupConsumerRepo({ scripts: { check: 'test ! -f broken.flag' } });

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	return dir;
};

/** A stub whose executor resolves the finding but breaks the gate; cheap fixes are no-ops. */
const gateBreakingInvoke = ({ dir, prompts, onSupervisor }: { dir: string; prompts: string[]; onSupervisor: () => { text: string; exitCode: number; rateLimited?: boolean } }): Driver['invoke'] => {
	let executorCalls = 0;

	return async ({ prompt }) => {
		prompts.push(prompt);

		if (prompt.includes('# Failing step')) {
			return onSupervisor();
		}

		if (prompt.includes('# Supervisor guidance')) {
			rmSync(join(dir, 'broken.flag'));

			return { text: report(), exitCode: 0 };
		}

		executorCalls += 1;

		if (executorCalls === 1) {
			writeFileSync(join(dir, 'src/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'src/beta.ts'), 'export const beta = 2;\n');
			writeFileSync(join(dir, 'broken.flag'), 'red\n');

			return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }, { path: 'src/beta.ts', summary: 'split' }] }), exitCode: 0 };
		}

		return { text: report(), exitCode: 0 };
	};
};

test('refactor: supervisor guidance rescues a red-gated batch', async () => {
	const dir = supervisorFixture();
	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: gateBreakingInvoke({
			dir,
			prompts,
			onSupervisor: () => ({
				text: JSON.stringify({ decision: 'retry', diagnosis: 'broken.flag trips the check gate', guidance: 'delete broken.flag' }),
				exitCode: 0,
				usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.01 },
			}),
		}),
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, true, `the guided retry must rescue the batch: ${result.error}`);
	assert.equal(result.after['structure'] ?? 0, 0, 'the finding burned down');

	const guided = prompts.find((prompt) => prompt.includes('# Supervisor guidance'));

	assert.ok(guided?.includes('broken.flag trips the check gate'), 'the diagnosis rides the guided retry');
	assert.ok(guided?.includes('delete broken.flag'), 'the guidance rides the guided retry');

	const ledger = readFileSync(join(dir, '.lightsout/runs', result.manifest.runId, 'agents.jsonl'), 'utf8');

	assert.ok(ledger.includes(':supervisor'), 'the consult is on the usage ledger');
});

test('refactor: a supervisor escalate verdict ends the run with the diagnosis attached', async () => {
	const dir = supervisorFixture();
	const driver: Driver = {
		name: 'stub',
		invoke: gateBreakingInvoke({
			dir,
			prompts: [],
			onSupervisor: () => ({
				text: JSON.stringify({ decision: 'escalate', diagnosis: 'the gate red is a real defect a human must rule on' }),
				exitCode: 0,
			}),
		}),
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'escalated');
	assert.match(result.error ?? '', /a human must rule on/, 'the diagnosis is the escalation evidence');
});

test('refactor: a rate-limited supervisor parks the run, not fails it', async () => {
	const dir = supervisorFixture();
	const driver: Driver = {
		name: 'stub',
		invoke: gateBreakingInvoke({
			dir,
			prompts: [],
			onSupervisor: () => ({ text: 'usage limit reached', exitCode: 1, rateLimited: true }),
		}),
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	assert.equal(result.ok, false);
	assert.equal(result.manifest.status, 'paused-rate-limit', 'rate-limit exhaustion is a pausable state, never an error');
});
