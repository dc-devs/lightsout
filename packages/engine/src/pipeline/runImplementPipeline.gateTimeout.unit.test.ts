import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { runImplementPipeline } from '#src/pipeline/runImplementPipeline.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

// Small enough that a hung gate costs the test about a second per attempt,
// large enough that the clean slate's green gates finish well inside it.
const ceilingConfig = { timeouts: { 'gate-minutes': 0.02 } };

/**
 * A consumer repo whose unit gate is green until implement lands, and hangs
 * for good afterwards — alive far past the ceiling, so every attempt is killed
 * by the deadline rather than ending with a verdict.
 *
 * Green first because the run gates its own clean slate before implement is
 * invoked, and a repo that hung there would never reach the step this test is
 * about.
 */
const setupTimingOutVerifyRun = async () => {
	const dir = setupConsumerRepo({ scripts: { test: 'node hang.cjs' }, config: ceilingConfig });

	writeFileSync(
		join(dir, 'hang.cjs'),
		[`const fs = require('node:fs');`, `if (!fs.existsSync('BROKEN')) {`, `\tprocess.exit(0);`, `}`, `setTimeout(() => {}, 30000);`, ''].join('\n'),
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

test('verify: a gate that runs past its ceiling on both attempts stops the step naming the gate and the ceiling, without a fix', async () => {
	const { dir, driver, counts, config } = await setupTimingOutVerifyRun();

	const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
	const step = result.manifest.steps.find((step) => step.id === 'verify-implement');

	// the timeout is named for what it is — which gate, and which ceiling it ran
	// past — so the operator reads "re-run or raise the ceiling", not "your tests
	// are broken"
	expect(result.error ?? '').toMatch(/verify-implement/);
	expect(result.error ?? '').toMatch(/test timed out/);
	expect(result.error ?? '').toContain('0.02-minute');
	expect(result.error ?? '').not.toMatch(/still failing after retries/);
	// nothing was asked to repair a gate that never returned a verdict
	expect({ fix: counts.fix, supervisor: counts.supervisor }).toStrictEqual({ fix: undefined, supervisor: undefined });
	// no family's fix budget was spent, and the timed-out gate is not a failed family
	expect(step?.verification?.repairAttempts).toStrictEqual({});
	expect(step?.verification?.failedFamilies).toStrictEqual([]);
	// a gate that never finished is not a green gate
	expect(result.manifest.status).toBe('escalated');
});
