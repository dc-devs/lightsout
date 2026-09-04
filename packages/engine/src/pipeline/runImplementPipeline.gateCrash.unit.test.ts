import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readFriction } from '#src/runState/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
/** Jest's tally when a worker died and took a suite with it: suites failed, no test did. */
const crashOnlyTally = 'Test Suites: 1 failed, 3 passed, 4 total\nTests:       11 passed, 11 total';
/** The same crash on a run that also has a genuinely broken test. */
const crashBesideFailureTally = 'Test Suites: 2 failed, 2 passed, 4 total\nTests:       1 failed, 10 passed, 11 total';

/**
 * A consumer repo whose unit gate is green until implement lands, and red for
 * good afterwards — red the way the toolchain is, with a jest worker killed by
 * SIGSEGV, and with whichever tally the case is about beneath it.
 *
 * Green first because the run gates its own clean slate before implement is
 * invoked, and a repo that crashed there would never reach the step these
 * tests are about.
 */
const setupCrashingVerifyRun = async ({ tally }: { tally: string }) => {
	const dir = setupConsumerRepo({ scripts: { test: 'node crash.cjs' } });

	writeFileSync(
		join(dir, 'crash.cjs'),
		[
			`const fs = require('node:fs');`,
			`if (!fs.existsSync('BROKEN')) {`,
			`\tprocess.exit(0);`,
			`}`,
			`process.stderr.write(${JSON.stringify(`${jestWorkerSigsegv}\n${tally}\n`)});`,
			`process.exit(1);`,
			'',
		].join('\n'),
	);

	const counts: Record<string, number> = {};
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			counts[role] = (counts[role] ?? 0) + 1;

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			if (role === 'supervisor') {
				return { text: verdict({ decision: 'escalate', diagnosis: 'stub diagnosis' }), exitCode: 0 };
			}

			if (role === 'fix') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });
			writeFileSync(join(dir, 'BROKEN'), 'x');

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, counts, config: await readConfig({ cwd: dir }) };
};

test('verify: a gate that only ever crashes stops the step without buying a fix or a verdict', async () => {
	const { dir, driver, counts, config } = await setupCrashingVerifyRun({ tally: crashOnlyTally });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const step = result.manifest.steps.find((step) => step.id === 'verify-implement');

	// the crash is named for what it is, so the operator reads "re-run me"
	// rather than "your tests are broken"
	expect(result.error ?? '').toMatch(/a gate crashed instead of failing/);
	expect(result.error ?? '').toContain(jestWorkerSigsegv);
	// nothing was asked to repair a suite that is not broken
	expect({ fix: counts.fix, supervisor: counts.supervisor }).toStrictEqual({ fix: undefined, supervisor: undefined });
	// and no family's fix budget was spent, so a re-run starts with all of it
	expect(step?.verification?.repairAttempts).toStrictEqual({});
	expect(step?.verification?.failedFamilies).toStrictEqual([]);
	// the crashed gate is not offered as failing-test evidence either
	expect(step?.verification?.failures).toStrictEqual([]);
	// a gate that never ran is not a green gate
	expect(result.manifest.status).toBe('escalated');
});

test('verify: an unabsorbed crash reaches the operator through the run friction ledger', async () => {
	const { dir, driver, config } = await setupCrashingVerifyRun({ tally: crashOnlyTally });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const crashFriction = (await readFriction({ cwd: dir })).filter((entry) => entry.runId === result.manifest.runId && entry.detail.includes('SIGSEGV'));

	// the durable trace is what makes a rare crash countable across runs instead
	// of a line that scrolled past on one night nobody was watching
	expect(crashFriction.length).toBeGreaterThan(0);
	expect(crashFriction[0]).toEqual(expect.objectContaining({ area: 'environment', step: 'verify-implement' }));
});

test('verify: a failing test that repeats under a crashing worker still fails the step the ordinary way', async () => {
	const { dir, driver, counts, config } = await setupCrashingVerifyRun({ tally: crashBesideFailureTally });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const step = result.manifest.steps.find((step) => step.id === 'verify-implement');

	// the tally names a failing test, so the red is evidence about the code —
	// the crash beside it buys the run no amnesty
	expect(result.error ?? '').toMatch(/verify-implement: still failing after retries\./);
	expect(result.error ?? '').not.toMatch(/a gate crashed instead of failing/);
	expect({ fix: counts.fix, supervisor: counts.supervisor }).toStrictEqual({ fix: 2, supervisor: 1 });
	expect(step?.verification?.repairAttempts).toStrictEqual({ test: 2 });
	expect(result.manifest.status).toBe('escalated');
});
