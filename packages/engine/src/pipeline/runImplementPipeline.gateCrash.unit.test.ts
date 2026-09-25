import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { jestCrashCause } from '#src/common/constants/jestCrashCause.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { readFriction } from '#src/runState/readFriction.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const jestWorkerSigsegv = 'A jest worker process (pid=49337) was terminated by another process: signal=SIGSEGV, exitCode=null.';
/** Jest's tally when a worker died and took a suite with it: suites failed, no test did. */
const crashOnlyTally = 'Test Suites: 1 failed, 3 passed, 4 total\nTests:       11 passed, 11 total';
/** The same crash on a run that also has a genuinely broken test. */
const crashBesideFailureTally = 'Test Suites: 2 failed, 2 passed, 4 total\nTests:       1 failed, 10 passed, 11 total';

/**
 * A repo whose unit gate crashes once implement lands. Green before that, so the
 * run's clean-slate gate passes and the run reaches verify.
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
		invoke: withTestChangeReview({
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
		}),
	};

	return { dir, driver, counts, config: await readConfig({ cwd: dir }) };
};

test('verify: a gate that only ever crashes stops the step without buying a fix or a verdict', async () => {
	const { dir, driver, counts, config } = await setupCrashingVerifyRun({ tally: crashOnlyTally });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const step = result.manifest.steps.find((step) => step.id === 'verify-implement');

	expect(result.error ?? '').toMatch(/a gate crashed instead of failing/);
	expect(result.error ?? '').toContain(jestWorkerSigsegv);
	expect({ fix: counts.fix, supervisor: counts.supervisor }).toStrictEqual({ fix: undefined, supervisor: undefined });
	expect(step?.verification?.repairAttempts).toStrictEqual({});
	expect(step?.verification?.failedFamilies).toStrictEqual([]);
	expect(step?.verification?.failures).toStrictEqual([]);
	expect(result.manifest.status).toBe('escalated');
});

test('verify: an unabsorbed crash reaches the operator through the run friction ledger', async () => {
	const { dir, driver, config } = await setupCrashingVerifyRun({ tally: crashOnlyTally });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const crashFriction = (await readFriction({ cwd: dir })).filter((entry) => entry.runId === result.manifest.runId && entry.detail.includes(jestCrashCause));

	expect(crashFriction.length).toBeGreaterThan(0);
	expect(crashFriction[0]).toEqual(expect.objectContaining({ area: 'environment', step: 'verify-implement' }));
});

test('verify: a failing test that repeats under a crashing worker still fails the step the ordinary way', async () => {
	const { dir, driver, counts, config } = await setupCrashingVerifyRun({ tally: crashBesideFailureTally });

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const step = result.manifest.steps.find((step) => step.id === 'verify-implement');

	expect(result.error ?? '').toMatch(/verify-implement: still failing after retries\./);
	expect(result.error ?? '').not.toMatch(/a gate crashed instead of failing/);
	expect({ fix: counts.fix, supervisor: counts.supervisor }).toStrictEqual({ fix: 2, supervisor: 1 });
	expect(step?.verification?.repairAttempts).toStrictEqual({ test: 2 });
	expect(result.manifest.status).toBe('escalated');
});
