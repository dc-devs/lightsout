import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runRefactorPipeline } from '#src/refactor/index.ts';
import { readRunManifest } from '#src/runState/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alpha = 1;\nexport const beta = 2;\n';

/** A driver whose refactor executor actually fixes a multi-export file by splitting it. */
const fixingDriver = ({ dir }: { dir: string }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		if (roleOf(prompt) === 'standards-review') {
			return { text: reviewReport(), exitCode: 0 };
		}

		const target = prompt.match(/- (\S+\.ts)/)?.[1];

		if (target) {
			const beta = target.replace(/([^/]+)\.ts$/, 'beta.ts');

			writeSource({ dir, path: target, source: 'export const alpha = 1;\n' });
			writeSource({ dir, path: beta, source: 'export const beta = 2;\n' });

			return {
				text: report({
					changedFiles: [
						{ path: target, summary: 'split' },
						{ path: beta, summary: 'split' },
					],
				}),
				exitCode: 0,
			};
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

/**
 * A driver that fixes the finding it was pointed at and plants a fresh blocking
 * one somewhere else — the shape a real refactor takes when an extraction
 * leaves the extracted file short of the standards.
 */
const sloppyDriver = ({ dir }: { dir: string }): Driver => ({
	name: 'stub',
	invoke: async ({ prompt }) => {
		if (roleOf(prompt) === 'standards-review') {
			return { text: reviewReport(), exitCode: 0 };
		}

		const target = prompt.match(/- (\S+\.ts)/)?.[1];

		if (target) {
			writeSource({ dir, path: target, source: 'export const alpha = 1;\n' });
			writeSource({ dir, path: 'src/extracted.ts', source: multiExport });

			return {
				text: report({
					changedFiles: [
						{ path: target, summary: 'split' },
						{ path: 'src/extracted.ts', summary: 'extracted' },
					],
				}),
				exitCode: 0,
			};
		}

		return { text: report({ changedFiles: [] }), exitCode: 0 };
	},
});

test('refactor: a run that trades one finding for a new one fails — a burn-down that burns nothing down is not a pass', async () => {
	const dir = setupConsumerRepo({ sources: { 'src/multi.ts': multiExport } });

	const result = await runRefactorPipeline({ cwd: dir, driver: sloppyDriver({ dir }), config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	// the run made this one — it was never on the work-list it was handed
	expect(result.error ?? '').toContain('refactor introduced 1 blocking finding(s) it never set out to fix');
	expect(result.error ?? '').toContain('multi-export:src/extracted.ts');
	// the burn-down still rides out: the table is the evidence for what happened
	expect(result.before['multi-export']).toBe(1);
	expect(result.after['multi-export']).toBe(1);

	const manifest = await readRunManifest({ cwd: dir, runId: result.manifest.runId });

	expect(manifest.status).toBe('failed');
	expect(manifest.steps.find((step) => step.id === 'final-check')?.status).toBe('failed');
});

test('refactor: a batch the executor fixes is resolved, with a burn-down', async () => {
	const dir = setupConsumerRepo({ sources: { 'src/multi.ts': multiExport } });

	const result = await runRefactorPipeline({ cwd: dir, driver: fixingDriver({ dir }), config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(true);
	expect(result.declined.length).toBe(0);
	expect(result.before['multi-export']).toBe(1);
	// the multi-export finding burned down
	expect(result.after['multi-export'] ?? 0).toBe(0);

	const batch = result.manifest.steps.find((step) => step.id.startsWith('batch-'));

	// batch id names the rule
	expect(batch?.id.includes('multi-export')).toBeTruthy();
	expect(batch?.status).toBe('passed');
});

test('refactor: zero changes with persisting clusters is a decline — recorded, run still ok', async () => {
	const dir = setupConsumerRepo({ sources: { 'src/multi.ts': multiExport } });

	const result = await runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(true);
	expect(result.declined.length).toBe(1);
	// the persisting cluster is named
	expect(result.declined[0]?.remainingSiteKeys[0]?.startsWith('multi-export:')).toBeTruthy();
	// the agent's rationale rides along
	expect(result.declined[0]?.rationale[0]?.includes('left as-is')).toBeTruthy();
});

test('refactor: three consecutive declines stop the run as systemic', async () => {
	const dir = setupConsumerRepo({ sources: Object.fromEntries(['alpha', 'beta', 'gamma'].map((folder) => [`${folder}/multi.ts`, multiExport])) });

	const result = await runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	expect(result.error ?? '').toMatch(/consecutive batches declined/);
	expect(result.manifest.status).toBe('escalated');
	expect(result.declined.length).toBe(3);
});

test('refactor: a dirty tree is a hard error before any run state exists', async () => {
	const dir = setupConsumerRepo();

	writeSource({ dir, path: 'src/uncommitted.ts', source: 'export const later = 1;\n' });

	await expect(runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await readConfig({ cwd: dir }) })).rejects.toThrow(/requires a clean tree/);
});

test('refactor: --allow-dirty records the standing dirt as baseline and never attributes it to a batch', async () => {
	const dir = setupConsumerRepo({ sources: { 'src/multi.ts': multiExport, 'src/uncommitted.ts': 'export const later = 1;\n' } });
	// the standing dirt: an uncommitted edit to a file no batch touches
	writeSource({ dir, path: 'src/uncommitted.ts', source: 'export const later = 2;\n' });

	const result = await runRefactorPipeline({ cwd: dir, driver: fixingDriver({ dir }), config: await readConfig({ cwd: dir }), allowDirty: true });

	expect(result.ok).toBe(true);
	expect(result.after['multi-export'] ?? 0).toBe(0);
	// the dirt is frozen into the manifest as baseline...
	expect(result.manifest.baselineDirtyFiles).toStrictEqual(['src/uncommitted.ts']);
	// ...and the batch owns only its own edits, however git sees the union
	expect(result.manifest.changedFiles.sort()).toStrictEqual(['src/beta.ts', 'src/multi.ts', 'src/useBeta.ts', 'src/useMulti.ts']);
});

test('refactor: a red pre-flight gate fails the run before any batch', async () => {
	const dir = setupConsumerRepo({ scripts: { check: 'false' }, sources: { 'src/multi.ts': multiExport } });

	const invocations: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			invocations.push(prompt);

			return { text: report(), exitCode: 0 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	expect(result.error ?? '').toMatch(/not green before refactoring/);
	// no agent was spawned against a red baseline
	expect(invocations.length).toBe(0);
});

test('refactor: an empty work-list completes as a verdict, spawning nothing', async () => {
	const dir = setupConsumerRepo();
	const invocations: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			invocations.push(prompt);

			return { text: report(), exitCode: 0 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

	expect(result.ok).toBe(true);
	expect(invocations.length).toBe(0);
	expect(result.manifest.status).toBe('passed');
});

test('refactor: a rate limit parks the run; resume finishes it', async () => {
	const dir = setupConsumerRepo({ sources: { 'src/multi.ts': multiExport } });

	let calls = 0;
	const parkThenFix: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			if (roleOf(invocation.prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			calls += 1;

			if (calls === 1) {
				return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
			}

			return fixingDriver({ dir }).invoke(invocation);
		},
	};

	const config = await readConfig({ cwd: dir });
	const parked = await runRefactorPipeline({ cwd: dir, driver: parkThenFix, config });

	expect(parked.ok).toBe(false);
	expect(parked.manifest.status).toBe('paused-rate-limit');

	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runRefactorPipeline({ cwd: dir, driver: parkThenFix, config, existing });

	expect(resumed.ok).toBe(true);
	// resume continues the same run
	expect(resumed.manifest.runId).toBe(parked.manifest.runId);
	expect(resumed.after['multi-export'] ?? 0).toBe(0);
});

test('refactor: --max-batches parks resumable at the budget ceiling', async () => {
	const dir = setupConsumerRepo({ sources: Object.fromEntries(['alpha', 'beta'].map((folder) => [`${folder}/multi.ts`, multiExport])) });

	const result = await runRefactorPipeline({ cwd: dir, driver: fixingDriver({ dir }), config: await readConfig({ cwd: dir }), maxBatches: 1 });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('paused-budget');
	expect(result.error ?? '').toMatch(/--max-batches 1/);

	const passedBatches = result.manifest.steps.filter((step) => step.id.startsWith('batch-') && step.status === 'passed');

	// exactly one batch ran before the ceiling
	expect(passedBatches.length).toBe(1);
});

test('refactor: declines recorded before a park survive the resume (report, streak, and all)', async () => {
	const dir = setupConsumerRepo({ sources: Object.fromEntries(['alpha', 'beta'].map((folder) => [`${folder}/multi.ts`, multiExport])) });

	let betaCalls = 0;
	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			if (roleOf(invocation.prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (invocation.prompt.includes('- [multi-export] alpha/multi.ts')) {
				return { text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'alpha left as-is' }] }), exitCode: 0 };
			}

			betaCalls += 1;

			if (betaCalls === 1) {
				return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
			}

			writeSource({ dir, path: 'beta/multi.ts', source: 'export const alpha = 1;\n' });
			writeSource({ dir, path: 'beta/beta.ts', source: 'export const beta = 2;\n' });

			return {
				text: report({
					changedFiles: [
						{ path: 'beta/multi.ts', summary: 'split' },
						{ path: 'beta/beta.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const config = await readConfig({ cwd: dir });
	const parked = await runRefactorPipeline({ cwd: dir, driver, config });

	expect(parked.manifest.status).toBe('paused-rate-limit');
	// alpha declined before the park
	expect(parked.declined.length).toBe(1);

	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runRefactorPipeline({ cwd: dir, driver, config, existing });

	expect(resumed.ok).toBe(true);
	// the pre-park decline survives the resume — it is the run's deliverable
	expect(resumed.declined.length).toBe(1);
	expect(resumed.declined[0]?.batchId.includes('alpha')).toBeTruthy();
	expect(resumed.declined[0]?.rationale[0]?.includes('alpha left as-is')).toBeTruthy();
	// and names what still persists, read back off the persisted report rather
	// than process memory — a decline the human cannot locate is not reviewable
	expect(resumed.declined[0]?.remainingSiteKeys).toStrictEqual(['multi-export:alpha/multi.ts']);
});

test('refactor: terminated:scope is a decline that continues, not a run-ending escalation', async () => {
	const dir = setupConsumerRepo({ sources: Object.fromEntries(['alpha', 'beta'].map((folder) => [`${folder}/multi.ts`, multiExport])) });

	const driver: Driver = {
		name: 'stub',
		invoke: async (invocation) => {
			if (roleOf(invocation.prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (invocation.prompt.includes('- [multi-export] alpha/multi.ts')) {
				return { text: report({ status: 'terminated:scope', failures: ['cannot be resolved in scope'] }), exitCode: 0 };
			}

			writeSource({ dir, path: 'beta/multi.ts', source: 'export const alpha = 1;\n' });
			writeSource({ dir, path: 'beta/beta.ts', source: 'export const beta = 2;\n' });

			return {
				text: report({
					changedFiles: [
						{ path: 'beta/multi.ts', summary: 'split' },
						{ path: 'beta/beta.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

	// a scope refusal must not end the run: ${result.error}
	expect(result.ok).toBe(true);
	// the scope refusal is recorded as a decline
	expect(result.declined.length).toBe(1);
	// the refusal reason rides the decline
	expect(result.declined[0]?.rationale.some((line) => line.includes('cannot be resolved in scope'))).toBeTruthy();
	// the other batch still ran and resolved
	expect(result.after['multi-export'] ?? 0).toBe(1);
});

test('refactor: an invocation failure whose work is verifiably done is salvaged as resolved', async () => {
	const dir = setupConsumerRepo({ sources: { 'src/multi.ts': multiExport } });

	// The laptop-sleep shape: the agent fixes the finding on disk, then dies
	// without ever producing a valid report (both contract attempts fail).
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/multi.ts', source: 'export const alpha = 1;\n' });
			writeSource({ dir, path: 'src/beta.ts', source: 'export const beta = 2;\n' });

			return { text: 'no json here — the process died mid-report', exitCode: 1 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }) });

	// verified work must be salvaged, not failed: ${result.error}
	expect(result.ok).toBe(true);
	// the finding is gone
	expect(result.after['multi-export'] ?? 0).toBe(0);

	const batch = result.manifest.steps.find((step) => step.id.startsWith('batch-'));

	// the salvage is recorded honestly on the step
	expect(JSON.stringify(batch?.report).includes('salvaged')).toBeTruthy();
});
