import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

test('write-tests fan-out: files under __tests__/ are test files, never writer targets', async () => {
	// The fixture below plants a helper inside `src/__tests__/`, which is the
	// whole point of the case and is also two path-rule violations. Those rules
	// now reach the gate (a finding whose only site is a test file used to be
	// unmatchable), so they are switched off here rather than allowed to
	// escalate a run this test is not about.
	const dir = setupConsumerRepo({
		config: {
			'standards-checks': {
				...reachabilityRulesOff['standards-checks'],
				'test-in-tests-folder': 'off',
				'test-not-beside-subject': 'off',
			},
		},
	});
	const writerTargets: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writerTargets.push(prompt.match(/- (\S+)/)?.[1] ?? 'unknown');
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			// Implement: one behavioral module plus a helper inside __tests__/ —
			// the divergence case: the old pipeline predicate missed dunder dirs
			// and spawned a writer to write tests for a test helper.
			writeFileSync(join(dir, 'src/feature.ts'), 'export const feature = (n: number): number => n * 2;\n');
			mkdirSync(join(dir, 'src/__tests__'), { recursive: true });
			writeFileSync(join(dir, 'src/__tests__/feature.helper.ts'), 'export const stubFeature = (): number => 4;\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.ts', summary: 'feature' },
						{ path: 'src/__tests__/feature.helper.ts', summary: 'test helper' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	const result = await runImplementPipeline({
		cwd: dir,
		driver,
		config: await readConfig({ cwd: dir }),
		planPath: 'plan.md',
	});

	expect(result.ok).toBe(true);
	// the __tests__/ helper must not earn a test writer
	expect(writerTargets).toStrictEqual(['src/feature.ts']);
});
