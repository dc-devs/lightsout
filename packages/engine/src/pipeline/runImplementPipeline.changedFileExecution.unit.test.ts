import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { reviewReport } from '@tests/helpers/reviewReport';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { verdict } from '@tests/helpers/verdict';
import { loadConfig } from '@/common/utils/loadConfig';
import type { Driver } from '@/drivers';
import { runImplementPipeline } from '@/pipeline';

/** Statement counts per repo-relative file, as an Istanbul json-summary reports them. */
type Statements = Record<string, { covered: number; total: number }>;

/**
 * An Istanbul json-summary at the default path — absolute keys plus the total
 * entry, exactly what a consumer's coverage command leaves behind.
 */
const writeCoverageSummary = ({ dir, statements }: { dir: string; statements: Statements }) => {
	mkdirSync(join(dir, 'coverage'), { recursive: true });
	writeFileSync(
		join(dir, 'coverage', 'coverage-summary.json'),
		JSON.stringify({
			total: { statements: { pct: 100, covered: 10, total: 10 } },
			...Object.fromEntries(Object.entries(statements).map(([file, counts]) => [join(dir, file), { statements: { pct: 0, ...counts } }])),
		}),
	);
};

interface SetupParams {
	/** Source files the implement step lands, as repo-relative path → content. */
	sources?: Record<string, string>;
	/** What the coverage summary says about those files before the run starts. */
	statements: Statements;
	/** Counts the summary is rewritten to when a write-tests fix retry runs; undefined leaves it alone. */
	onFix?: Statements;
}

/**
 * A consumer repo whose coverage gate is a no-op command over a summary this
 * test writes by hand, so the per-file executed check reads exactly the
 * numbers each case is about. TypeScript is linked because without a consumer
 * compiler the check stands down entirely.
 */
const setupExecutionRun = async ({ sources = { 'src/feature.ts': 'export const feature = () => 1;\n' }, statements, onFix }: SetupParams) => {
	const dir = setupConsumerRepo({ scripts: { testCoverage: 'true' } });

	linkTypescript({ dir });
	writeCoverageSummary({ dir, statements });

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'supervisor') {
				return { text: verdict(), exitCode: 0 };
			}

			if (role === 'refactor') {
				return { text: report(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				// the retry's tests reach the changed file: the summary now shows it ran
				if (prompt.includes('# Verification failure') && onFix) {
					writeCoverageSummary({ dir, statements: onFix });

					return { text: report(), exitCode: 0 };
				}

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			for (const [path, content] of Object.entries(sources)) {
				mkdirSync(dirname(join(dir, path)), { recursive: true });
				writeFileSync(join(dir, path), content);
			}

			return { text: report({ changedFiles: Object.keys(sources).map((path) => ({ path, summary: 'source' })) }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test('verify-tests: a changed file the tests never execute fails the gate with the named error', async () => {
		const { dir, driver, config } = await setupExecutionRun({ statements: { 'src/feature.ts': { covered: 0, total: 4 } } });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		expect(result.ok).toBe(false);
		expect(result.error ?? '').toContain('changed-file-execution: 1 changed file(s) never executed under the tests: src/feature.ts');
		expect(result.manifest.steps.find((step) => step.id === 'verify-tests')?.status).toBe('escalated');
		// the file was never executed from the moment it landed, yet the earlier
		// verify — the one that runs with coverage off — passed: only the
		// coverage-carrying gates hold the execution bar
		expect(result.manifest.steps.find((step) => step.id === 'verify-implement')?.status).toBe('passed');
		// and the empty changed set at clean-slate makes the check a no-op there
		expect(result.manifest.steps.find((step) => step.id === 'clean-slate')?.status).toBe('passed');
	});

	test('the gate clears once the changed file executes — one cheap retry finishes the run green', async () => {
		const { dir, driver, config } = await setupExecutionRun({
			statements: { 'src/feature.ts': { covered: 0, total: 4 } },
			onFix: { 'src/feature.ts': { covered: 4, total: 4 } },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		expect(result.ok).toBe(true);
		// the first attempt was red on execution alone; the fix retry cleared it
		expect(result.manifest.steps.find((step) => step.id === 'verify-tests')?.attempts).toBe(2);
	});

	test('a changed file recorded as unreachable is exempt — its missing coverage never fails the gate', async () => {
		const { dir, driver, config } = await setupExecutionRun({
			sources: {
				'src/feature/index.ts': "export { feature } from './feature';\n",
				'src/feature/feature.ts': 'export const feature = () => 1;\n',
				'src/feature/orphan.ts': 'export const orphan = () => 2;\n',
			},
			// the orphan is absent from the summary entirely — a violation if the check saw it
			statements: { 'src/feature/feature.ts': { covered: 3, total: 3 } },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		expect(result.ok).toBe(true);
		expect(result.manifest.unreachableChangedFiles).toStrictEqual(['src/feature/orphan.ts']);
	});
});
