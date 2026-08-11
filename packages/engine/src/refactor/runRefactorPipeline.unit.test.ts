import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { loadConfig } from '@/common/utils/loadConfig';
import { RunManifest } from '@/contracts';
import type { Driver } from '@/drivers';
import { runRefactorPipeline } from '@/refactor';
import { readRunManifest } from '@/runState';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alpha = 1;\nexport const beta = 2;\n';

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

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

			writeFileSync(join(dir, target), 'export const alpha = 1;\n');
			writeFileSync(join(dir, beta), 'export const beta = 2;\n');

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

test('refactor: a batch the executor fixes is resolved, with a burn-down', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: fixingDriver({ dir }), config: await loadConfig({ cwd: dir }) });

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
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await loadConfig({ cwd: dir }) });

	expect(result.ok).toBe(true);
	expect(result.declined.length).toBe(1);
	// the persisting cluster is named
	expect(result.declined[0]?.remainingSiteKeys[0]?.startsWith('multi-export:')).toBeTruthy();
	// the agent's rationale rides along
	expect(result.declined[0]?.rationale[0]?.includes('left as-is')).toBeTruthy();
});

test('refactor: three consecutive declines stop the run as systemic', async () => {
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta', 'gamma']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await loadConfig({ cwd: dir }) });

	expect(result.ok).toBe(false);
	expect(result.error ?? '').toMatch(/consecutive batches declined/);
	expect(result.manifest.status).toBe('escalated');
	expect(result.declined.length).toBe(3);
});

test('refactor: a dirty tree is a hard error before any run state exists', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/uncommitted.ts'), 'export const later = 1;\n');

	await expect(runRefactorPipeline({ cwd: dir, driver: decliningDriver, config: await loadConfig({ cwd: dir }) })).rejects.toThrow(/requires a clean tree/);
});

test('refactor: a red pre-flight gate fails the run before any batch', async () => {
	const dir = setupConsumerRepo({ scripts: { check: 'false' } });

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

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

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

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

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	expect(result.ok).toBe(true);
	expect(invocations.length).toBe(0);
	expect(result.manifest.status).toBe('passed');
});

test('refactor: a rate limit parks the run; resume finishes it', async () => {
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

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

	const config = await loadConfig({ cwd: dir });
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
	const dir = setupConsumerRepo();

	for (const folder of ['alpha', 'beta']) {
		mkdirSync(join(dir, folder), { recursive: true });
		writeFileSync(join(dir, folder, 'multi.ts'), multiExport);
	}

	commitAll(dir);

	const result = await runRefactorPipeline({ cwd: dir, driver: fixingDriver({ dir }), config: await loadConfig({ cwd: dir }), maxBatches: 1 });

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('paused-budget');
	expect(result.error ?? '').toMatch(/--max-batches 1/);

	const passedBatches = result.manifest.steps.filter((step) => step.id.startsWith('batch-') && step.status === 'passed');

	// exactly one batch ran before the ceiling
	expect(passedBatches.length).toBe(1);
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

			writeFileSync(join(dir, 'beta/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'beta/beta.ts'), 'export const beta = 2;\n');

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

	const config = await loadConfig({ cwd: dir });
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

	await expect(runRefactorPipeline({ cwd: dir, driver: decliningDriver, config, existing: implementManifest })).rejects.toThrow(
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
			if (roleOf(invocation.prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (invocation.prompt.includes('- [multi-export] alpha/multi.ts')) {
				return { text: report({ status: 'terminated:scope', failures: ['cannot be resolved in scope'] }), exitCode: 0 };
			}

			writeFileSync(join(dir, 'beta/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'beta/beta.ts'), 'export const beta = 2;\n');

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

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

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
	const dir = setupConsumerRepo();

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	// The laptop-sleep shape: the agent fixes the finding on disk, then dies
	// without ever producing a valid report (both contract attempts fail).
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'src/beta.ts'), 'export const beta = 2;\n');

			return { text: 'no json here — the process died mid-report', exitCode: 1 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	// verified work must be salvaged, not failed: ${result.error}
	expect(result.ok).toBe(true);
	// the finding is gone
	expect(result.after['multi-export'] ?? 0).toBe(0);

	const batch = result.manifest.steps.find((step) => step.id.startsWith('batch-'));

	// the salvage is recorded honestly on the step
	expect(JSON.stringify(batch?.report).includes('salvaged')).toBeTruthy();
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
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			calls += 1;

			if (calls === 1) {
				return { text: 'usage limit reached', exitCode: 1, rateLimited: true };
			}

			prompts.push(prompt);
			writeFileSync(join(dir, 'alpha/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'alpha/beta.ts'), 'export const beta = 2;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'alpha/multi.ts', summary: 'split' },
						{ path: 'alpha/beta.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const config = await loadConfig({ cwd: dir });
	const parked = await runRefactorPipeline({ cwd: dir, driver, config });

	expect(parked.manifest.status).toBe('paused-rate-limit');

	// Between park and resume, the advisory's location shifts — the frozen
	// worklist now cites stale lines.
	writeFileSync(join(dir, 'alpha/multi.ts'), `${'// shift\n'.repeat(10)}export const alpha = 1;\n${bigFunction}`);

	const existing = await readRunManifest({ cwd: dir, runId: parked.manifest.runId });
	const resumed = await runRefactorPipeline({ cwd: dir, driver, config, existing });

	expect(resumed.ok).toBe(true);
	// the advisory in the prompt cites the LIVE line (12), not the frozen one (2)
	// — got:\n${prompts[0]?.split('\n').filter((line) =>
	// line.includes('[size-function]')).join('\n')}
	expect(prompts[0]?.includes('alpha/multi.ts:12')).toBeTruthy();
});

test('refactor: every advisory on the batch’s files rides the executor prompt, not only the size ones', async () => {
	const dir = setupConsumerRepo();

	mkdirSync(join(dir, 'alpha'), { recursive: true });
	mkdirSync(join(dir, 'beta'), { recursive: true });

	// Each file carries a multi-export FINDING plus a dead-export ADVISORY (its
	// exports are referenced nowhere). Distinct filenames keep the name rules
	// from producing an advisory that spans both folders.
	writeFileSync(join(dir, 'alpha/widget.ts'), 'export const alphaThing = 1;\nexport const betaThing = 2;\n');
	writeFileSync(join(dir, 'beta/gadget.ts'), 'export const gammaThing = 3;\nexport const deltaThing = 4;\n');
	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			if (roleOf(prompt) === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			prompts.push(prompt);

			return { text: report({ friction: [{ area: 'other', kind: 'decision', detail: 'left as-is: exempt by design' }] }), exitCode: 0 };
		},
	};

	const result = await runRefactorPipeline({ cwd: dir, driver, config: await loadConfig({ cwd: dir }) });

	expect(result.ok).toBe(true);

	const advisorySection = prompts.find((prompt) => prompt.includes('alpha/widget.ts'))?.split('Advisory —')[1] ?? '';

	// a dead-export advisory is not a size advisory, and an advisory the agent
	// never sees is one it can never judge:\n${advisorySection}
	expect(advisorySection.includes('[dead-export] alpha/widget.ts')).toBeTruthy();
	// its own guidance rides with it — each advisory rule asks for something
	// different, so a blanket instruction cannot stand in for it
	expect(advisorySection.includes('A dead code candidate.')).toBeTruthy();
	// and only the batch's own files: beta's advisory belongs to beta's batch
	expect(advisorySection.includes('beta/gadget.ts')).toBeFalsy();
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
const gateBreakingInvoke = ({
	dir,
	prompts,
	onSupervisor,
}: {
	dir: string;
	prompts: string[];
	onSupervisor: () => { text: string; exitCode: number; rateLimited?: boolean };
}): Driver['invoke'] => {
	let executorCalls = 0;

	return async ({ prompt }) => {
		if (roleOf(prompt) === 'standards-review') {
			return { text: reviewReport(), exitCode: 0 };
		}

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

			return {
				text: report({
					changedFiles: [
						{ path: 'src/multi.ts', summary: 'split' },
						{ path: 'src/beta.ts', summary: 'split' },
					],
				}),
				exitCode: 0,
			};
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

	// the guided retry must rescue the batch: ${result.error}
	expect(result.ok).toBe(true);
	// the finding burned down
	expect(result.after['multi-export'] ?? 0).toBe(0);

	const guided = prompts.find((prompt) => prompt.includes('# Supervisor guidance'));

	// the diagnosis rides the guided retry
	expect(guided?.includes('broken.flag trips the check gate')).toBeTruthy();
	// the guidance rides the guided retry
	expect(guided?.includes('delete broken.flag')).toBeTruthy();

	const ledger = readFileSync(join(dir, '.lightsout/runs', result.manifest.runId, 'agents.jsonl'), 'utf8');

	// the consult is on the usage ledger
	expect(ledger.includes(':supervisor')).toBeTruthy();
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

	expect(result.ok).toBe(false);
	expect(result.manifest.status).toBe('escalated');
	// the diagnosis is the escalation evidence
	expect(result.error ?? '').toMatch(/a human must rule on/);
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

	expect(result.ok).toBe(false);
	// rate-limit exhaustion is a pausable state, never an error
	expect(result.manifest.status).toBe('paused-rate-limit');
});
