import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { readRunManifest } from '#src/runState/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/**
 * What the run writes down about the work it set out to do, rather than the
 * work it has done: the step ids it declared at start, and the ship intent it
 * was started with. A reader watching a run needs both — one to show a row for
 * a step the run has not reached, the other to show a ship row at all.
 */
const setupDeclaredRun = () => {
	const dir = setupConsumerRepo();
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'implement') {
				writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

				return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
			}

			return { text: report(), exitCode: 0 };
		},
	};

	const run = async ({ skipRefactor, willShip }: { skipRefactor?: boolean; willShip?: boolean } = {}) =>
		runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md', skipRefactor, willShip });

	return { dir, run };
};

describe('runImplementPipeline', () => {
	test('declares every step id it will run, in order, so a reader can be shown the steps still to come', async () => {
		const { dir, run } = setupDeclaredRun();

		const result = await run();

		const persisted = await readRunManifest({ cwd: dir, runId: result.manifest.runId });

		expect(result.manifest.stepOrder).toStrictEqual([
			'clean-slate',
			'write-ledger-tests',
			'implement',
			'format-implement',
			'verify-implement',
			'write-tests',
			'format-tests',
			'verify-tests',
			'refactor',
			'format-refactor',
			'verify-refactor',
		]);
		// the reader only ever sees the file, never the returned value
		expect(persisted.stepOrder).toStrictEqual(result.manifest.stepOrder);
	});

	test('declares the shorter sequence when the refactor pair is skipped, rather than a step this run will never reach', async () => {
		const { run } = setupDeclaredRun();

		const result = await run({ skipRefactor: true });

		expect(result.manifest.stepOrder).toStrictEqual([
			'clean-slate',
			'write-ledger-tests',
			'implement',
			'format-implement',
			'verify-implement',
			'write-tests',
			'format-tests',
			'verify-tests',
		]);
	});

	test.each([
		{ label: 'a run resolved to ship records the intent', willShip: true, expected: true },
		{ label: 'a run nobody asked to ship records nothing', willShip: undefined, expected: undefined },
	])('$label', async ({ willShip, expected }) => {
		const { dir, run } = setupDeclaredRun();

		const result = await run({ willShip });

		const persisted = await readRunManifest({ cwd: dir, runId: result.manifest.runId });

		expect(persisted.willShip).toBe(expected);
	});
});
