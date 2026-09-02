import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { maxCheapFixRetries } from '#src/common/constants/maxCheapFixRetries.ts';
import type { Driver, DriverResult } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * A consumer repo whose unit gate goes red the moment implement lands (it
 * drops a BROKEN marker the `test` gate refuses) and never recovers, so
 * verify-implement always walks its full retry path. `fix` and `supervisor`
 * override what those two roles answer; `counts` records how many turns each
 * role was actually bought.
 */
const setupRedVerifyRun = async ({
	fix,
	supervisor,
	scripts,
	implement,
}: {
	fix?: (params: { dir: string; turn: number }) => DriverResult;
	supervisor?: () => DriverResult;
	scripts?: Record<string, string | false>;
	implement?: (params: { dir: string }) => void;
} = {}) => {
	const dir = setupConsumerRepo({ scripts: { test: 'test ! -f BROKEN', ...scripts } });
	const counts: Record<string, number> = {};
	const prompts: Record<string, string[]> = {};
	let fixTurns = 0;
	// A re-emit retry hands the rejected text back to the SAME role, but its
	// prompt carries none of that role's markers. Invocations here are strictly
	// sequential, so the role that just answered is the role being retried.
	let lastRole = 'implement';
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = prompt.includes('# Your previous final message') ? lastRole : roleOf(prompt);

			lastRole = role;
			prompts[role] = [...(prompts[role] ?? []), prompt];

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub test\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			counts[role] = (counts[role] ?? 0) + 1;

			if (role === 'supervisor') {
				return supervisor?.() ?? { text: verdict({ decision: 'escalate', diagnosis: 'stub diagnosis' }), exitCode: 0 };
			}

			if (role === 'fix') {
				fixTurns += 1;

				return fix?.({ dir, turn: fixTurns }) ?? { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
			if (implement) {
				implement({ dir });
			} else {
				writeFileSync(join(dir, 'BROKEN'), 'x');
			}

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, counts, prompts, config: await readConfig({ cwd: dir }) };
};

test('verify: a rate limit inside a cheap fix retry parks the run before judgment is bought', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({ fix: () => ({ text: '', exitCode: 1, rateLimited: true }) });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	// the first rate-limited fix ends the step — the second retry is never spent
	expect(counts.fix).toBe(1);
	// a parked run never consults the supervisor
	expect(counts.supervisor).toBe(undefined);
	// the park keeps the record it entered the retry with — the aborted fix
	// advances nothing
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(2);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.verification).toEqual(
		expect.objectContaining({ repairAttempts: { test: 1 }, needsFormatting: true, failedFamilies: ['test'] }),
	);
});

test('verify: a rate-limited supervisor parks the run after the cheap retries are spent', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({ supervisor: () => ({ text: '', exitCode: 1, rateLimited: true }) });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	// both mechanical retries ran before judgment was bought
	expect(counts.fix).toBe(2);
	// the supervisor was consulted exactly once
	expect(counts.supervisor).toBe(1);
});

test('verify: a retry verdict carrying no guidance escalates instead of buying a blind third fix', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		supervisor: () => ({ text: verdict({ decision: 'retry', diagnosis: 'DIAGNOSIS-SENTINEL' }), exitCode: 0 }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	// a retry with nothing to say buys no guided attempt
	expect(counts.fix).toBe(2);
	expect(result.error ?? '').toMatch(/verify-implement: still failing after retries\./);
	// the verdict is quoted with its decision
	expect(result.error ?? '').toMatch(/supervisor \(retry\): DIAGNOSIS-SENTINEL/);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.status).toBe('escalated');
});

test('verify: a verdict that never parses buys one re-emit retry, then escalates with no ruling to quote', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		supervisor: () => ({ text: 'The gate looks wrong to me — I have no JSON for you.', exitCode: 0 }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	// the contract re-emit is the only extra turn a malformed verdict buys
	expect(counts.supervisor).toBe(2);
	// no ruling survived, so no guided retry was spent either
	expect(counts.fix).toBe(2);
	expect(result.error ?? '').toMatch(/verify-implement: still failing after retries\./);
	// nothing is attributed to a supervisor that never ruled
	expect(result.error ?? '').not.toMatch(/supervisor \(/);
	// the red gate is still the evidence the escalation carries
	expect(result.error ?? '').toMatch(/test failed/);
});

test('verify: a rate limit inside the supervisor-guided retry parks the run instead of escalating it', async () => {
	let fixTurns = 0;
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		fix: () => {
			fixTurns += 1;

			// The two cheap retries answer normally; the guided third — the one the
			// supervisor's ruling bought — is where the harness runs out.
			return fixTurns === 3 ? { text: '', exitCode: 1, rateLimited: true } : { text: report(), exitCode: 0 };
		},
		supervisor: () => ({ text: verdict({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' }), exitCode: 0 }),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// a park a human can resume, never the escalation an exhausted path gives
	expect(result.manifest.status).toBe('paused-rate-limit');
	expect(result.error?.includes(`lightsout resume --run ${result.manifest.runId}`)).toBeTruthy();
	expect(counts.supervisor).toBe(1);
	// the guided attempt was bought before the limit hit
	expect(counts.fix).toBe(3);
	// and it is recorded, so a resume does not silently re-buy it
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.attempts).toBe(4);
	expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.verification?.guidedRepairAttempted).toBe(true);
});

test('verify: a fix invocation whose driver dies spends its turn without failing the step — the gate still decides', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		fix: () => {
			throw new Error('claude timed out after 3600000ms');
		},
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	// a dead fix is neither a run failure of its own nor a reason to cut the
	// retry budget short — the still-red gate is what ends the step
	expect(result.manifest.status).toBe('escalated');
	expect(counts.fix).toBe(2);
	expect(counts.supervisor).toBe(1);
	expect(result.error ?? '').toMatch(/supervisor \(escalate\): stub diagnosis/);
});

test('verify: a fix reporting failed earns no changed-file attribution — only a complete report is merged', async () => {
	const { dir, driver, config } = await setupRedVerifyRun({
		fix: () => ({
			text: report({ status: 'failed', failures: ['could not find the cause'], changedFiles: [{ path: 'src/ghost.js', summary: 'never written' }] }),
			exitCode: 0,
		}),
	});

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

	expect(result.manifest.status).toBe('escalated');
	// the file a failed fix claimed never becomes the run's truth
	expect(result.manifest.changedFiles.includes('src/ghost.js')).toBe(false);
	// what implement actually landed is still attributed
	expect(result.manifest.changedFiles.includes('src/feature.js')).toBe(true);
});

test('verify: an exhausted check family does not consume a newly exposed test family budget', async () => {
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		scripts: {
			check: 'test ! -f BROKEN_CHECK',
			test: 'test -f BROKEN_CHECK || test ! -f BROKEN_TEST',
			format: 'true',
		},
		implement: ({ dir: cwd }) => {
			writeFileSync(join(cwd, 'BROKEN_CHECK'), 'x');
			writeFileSync(join(cwd, 'BROKEN_TEST'), 'x');
		},
		fix: ({ dir: cwd, turn }) => {
			if (turn === maxCheapFixRetries) {
				unlinkSync(join(cwd, 'BROKEN_CHECK'));
			}

			if (turn === maxCheapFixRetries * 2) {
				unlinkSync(join(cwd, 'BROKEN_TEST'));
			}

			return { text: report(), exitCode: 0 };
		},
	});
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const verification = result.manifest.steps.find((step) => step.id === 'verify-implement')?.verification;
	const repairCommands = readCommandLog(dir, result.manifest.runId).filter((command) => command.step === 'verify-implement');
	const firstRepairFormat = repairCommands.findIndex((command) => command.kind === 'format');
	const nextGate = repairCommands.findIndex((command, index) => index > firstRepairFormat && command.kind === 'check');

	expect(result.ok).toBe(true);
	expect(counts.fix).toBe(maxCheapFixRetries * 2);
	expect(verification?.repairAttempts).toStrictEqual({ check: maxCheapFixRetries, test: maxCheapFixRetries });
	expect(verification?.failedFamilies).toStrictEqual([]);
	expect(verification?.failures).toStrictEqual([]);
	expect(firstRepairFormat).toBeGreaterThan(-1);
	expect(nextGate).toBeGreaterThan(firstRepairFormat);
});

test('verify: simultaneous root and package failures share one counter for their common kind', async () => {
	const { dir, driver } = await setupRedVerifyRun({
		scripts: { check: 'test ! -f BROKEN', test: 'true' },
		fix: ({ dir: cwd }) => {
			unlinkSync(join(cwd, 'BROKEN'));

			return { text: report(), exitCode: 0 };
		},
	});
	mkdirSync(join(dir, 'packages', 'api'), { recursive: true });
	writeFileSync(join(dir, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@acme/api' }));
	const scopedConfig = await readConfig({
		cwd: dir,
	});
	const configWithPackages = {
		...scopedConfig,
		'package-gates': { check: 'test ! -f BROKEN # {package}', test: 'true # {package}' },
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: configWithPackages, planPath: 'plan.md', packages: ['api'], skipRefactor: true });
	const verification = result.manifest.steps.find((step) => step.id === 'verify-implement')?.verification;

	expect(result.ok).toBe(true);
	expect(verification?.repairAttempts).toStrictEqual({ check: 1 });
});

test('verify: one repair invocation charges every simultaneously red family once', async () => {
	const { dir, driver, config } = await setupRedVerifyRun({
		scripts: { check: 'test ! -f BROKEN', test: 'test ! -f BROKEN' },
		fix: ({ dir: cwd }) => {
			unlinkSync(join(cwd, 'BROKEN'));

			return { text: report(), exitCode: 0 };
		},
	});
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const verification = result.manifest.steps.find((step) => step.id === 'verify-implement')?.verification;

	expect(result.ok).toBe(true);
	expect(verification?.repairAttempts).toStrictEqual({ check: 1, test: 1 });
});

test('verify: a rate-limited cheap repair resumes with formatting before gates and keeps its charged counter', async () => {
	let rateLimited = true;
	const { dir, driver, config } = await setupRedVerifyRun({
		scripts: { format: 'true' },
		fix: ({ dir: cwd }) => {
			if (rateLimited) {
				rateLimited = false;

				return { text: '', exitCode: 1, rateLimited: true };
			}

			unlinkSync(join(cwd, 'BROKEN'));

			return { text: report(), exitCode: 0 };
		},
	});
	const paused = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const before = readCommandLog(dir, paused.manifest.runId).length;
	const resumed = await runImplementPipeline({ cwd: dir, driver, config, existing: paused.manifest, skipRefactor: true });
	const appended = readCommandLog(dir, paused.manifest.runId).slice(before);
	const verification = resumed.manifest.steps.find((step) => step.id === 'verify-implement')?.verification;

	expect(appended[0]?.kind).toBe('format');
	expect(appended[1]?.kind).toBe('check');
	expect(verification?.repairAttempts).toStrictEqual({ test: maxCheapFixRetries });
	expect(verification?.needsFormatting).toBe(false);
});

test('verify: a guided repair rate limit cannot buy a second guided invocation after resume', async () => {
	let fixTurns = 0;
	const { dir, driver, counts, config } = await setupRedVerifyRun({
		fix: () => {
			fixTurns += 1;

			return fixTurns === maxCheapFixRetries + 1 ? { text: '', exitCode: 1, rateLimited: true } : { text: report(), exitCode: 0 };
		},
		supervisor: () => ({ text: verdict({ decision: 'retry', diagnosis: 'stale artifact', guidance: 'delete BROKEN' }), exitCode: 0 }),
	});
	const paused = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const resumed = await runImplementPipeline({ cwd: dir, driver, config, existing: paused.manifest, skipRefactor: true });

	expect(resumed.manifest.status).toBe('escalated');
	expect(counts.fix).toBe(maxCheapFixRetries + 1);
	expect(counts.supervisor).toBe(1);
});

test('verify: repair formatting precedes re-gating and a red formatter becomes command-backed format evidence', async () => {
	const { dir, driver, config } = await setupRedVerifyRun({
		scripts: { format: 'test ! -f FORMAT_RED' },
		fix: ({ dir: cwd, turn }) => {
			if (turn === 1) {
				writeFileSync(join(cwd, 'FORMAT_RED'), 'x');

				return { text: report(), exitCode: 0 };
			}

			return { text: '', exitCode: 1, rateLimited: true };
		},
	});
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const commands = readCommandLog(dir, result.manifest.runId);
	const lastFormat = commands.map((command) => command.kind).lastIndexOf('format');
	const verification = result.manifest.steps.find((step) => step.id === 'verify-implement')?.verification;

	expect(commands.slice(lastFormat + 1).some((command) => command.step === 'verify-implement' && command.kind !== 'format')).toBe(false);
	expect(verification?.failedFamilies).toStrictEqual(['format']);
	expect(verification?.failures[0]).toEqual(expect.objectContaining({ kind: 'format', group: 'root', exitCode: 1 }));
	expect(verification?.repairAttempts).toStrictEqual({ test: 1, format: 1 });
});

test('verify: final escalation persists ordered evidence, counters, guidance state, and diagnosis', async () => {
	const { dir, driver, prompts, config } = await setupRedVerifyRun({
		supervisor: () => ({ text: verdict({ decision: 'retry', diagnosis: 'persistent test defect', guidance: 'inspect the assertion' }), exitCode: 0 }),
	});
	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });
	const verification = result.manifest.steps.find((step) => step.id === 'verify-implement')?.verification;

	expect(verification?.failedFamilies).toStrictEqual(['test']);
	expect(verification?.failures).toHaveLength(1);
	expect(verification?.failures[0]).toEqual(expect.objectContaining({ kind: 'test', group: 'root', exitCode: 1 }));
	expect(verification?.repairAttempts).toStrictEqual({ test: maxCheapFixRetries });
	expect(verification?.guidedRepairAttempted).toBe(true);
	expect(verification?.supervisorDiagnosis).toBe('persistent test defect');
	expect(prompts.fix?.every((prompt) => prompt.includes('test failed'))).toBe(true);
	expect(prompts.supervisor?.[0]).toContain('test failed');
	expect(prompts.fix?.at(-1)).toContain('# Supervisor guidance');
	expect(result.error).toContain('test failed');
});
