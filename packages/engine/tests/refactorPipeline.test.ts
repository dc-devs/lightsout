import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { RunManifest } from '@lightsout/contracts';
import type { Driver } from '@lightsout/drivers';
import { loadConfig, readRunManifest, runRefactorPipeline } from '../src/index';
import { report } from './helpers/report';
import { setupConsumerRepo } from './helpers/setupConsumerRepo';

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
		driver: 'stub',
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
