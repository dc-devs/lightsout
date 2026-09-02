import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { readCommandLog } from '#tests/helpers/readCommandLog.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const countLog = (dir: string, file: string) => {
	try {
		return readFileSync(join(dir, file), 'utf8').length;
	} catch {
		return 0;
	}
};

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
	/** Jest settings to plant as the repo's own jest.config.cjs; omitted, the repo has no coverage configuration and every file reads as collected. */
	jestConfig?: Record<string, unknown>;
}

/**
 * A consumer repo whose coverage gate is a no-op command over a summary this
 * test writes by hand, so the per-file executed check reads exactly the
 * numbers each case is about. TypeScript is linked because without a consumer
 * compiler the check stands down entirely.
 */
const setupExecutionRun = async ({
	sources = { 'src/feature.ts': 'export const feature = (): number => 1;\n' },
	statements,
	onFix,
	jestConfig,
}: SetupParams) => {
	const dir = setupConsumerRepo({ scripts: { 'test-coverage': 'true' }, config: reachabilityRulesOff });

	linkTypescript({ dir });
	writeCoverageSummary({ dir, statements });

	if (jestConfig) {
		writeFileSync(join(dir, 'jest.config.cjs'), `module.exports = ${JSON.stringify(jestConfig)};\n`);
	}

	const writerPrompts: string[] = [];
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
				writerPrompts.push(prompt);

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

	return { dir, driver, config: await readConfig({ cwd: dir }), writerPrompts };
};

describe('runImplementPipeline', () => {
	test('verify-tests: a changed file the tests never execute fails the gate with the named error', async () => {
		const { dir, driver, config } = await setupExecutionRun({ statements: { 'src/feature.ts': { covered: 0, total: 4 } } });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		expect(result.ok).toBe(false);
		expect(result.error ?? '').toContain('changed-file-execution: 1 changed file(s) never executed under the tests: src/feature.ts');
		expect(result.manifest.steps.find((step) => step.id === 'verify-tests')?.status).toBe('escalated');
		expect(result.manifest.steps.find((step) => step.id === 'verify-tests')?.verification).toEqual(
			expect.objectContaining({ failedFamilies: ['changed-files-executed'], failures: [] }),
		);
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
				'src/feature/feature.ts': 'export const feature = (): number => 1;\n',
				'src/feature/orphan.ts': 'export const orphan = (): number => 2;\n',
			},
			// the orphan is absent from the summary entirely — a violation if the check saw it
			statements: { 'src/feature/feature.ts': { covered: 3, total: 3 } },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		expect(result.ok).toBe(true);
		expect(result.manifest.unreachableChangedFiles).toStrictEqual(['src/feature/orphan.ts']);
	});

	test('a run whose changed files the repo never collects coverage from reaches a passing verdict', async () => {
		const { dir, driver, config } = await setupExecutionRun({
			// a .tsx the positives never name, so no report can ever list it
			sources: { 'src/App.tsx': 'export const App = () => <div>hi</div>;\n' },
			statements: {},
			jestConfig: { collectCoverageFrom: ['src/**/*.ts'] },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		expect(result.ok).toBe(true);
		expect(result.manifest.coverageExcludedChangedFiles).toStrictEqual(['src/App.tsx']);
	});

	test('a changed file the repo DOES collect still fails the gate when the report never lists it', async () => {
		const { dir, driver, config } = await setupExecutionRun({ statements: {}, jestConfig: { collectCoverageFrom: ['src/**/*.ts'] } });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });

		expect(result.ok).toBe(false);
		expect(result.error ?? '').toContain('changed-file-execution: 1 changed file(s) never executed under the tests: src/feature.ts');
	});

	// The verify-tests fix re-invocation is the second place a writer is told
	// which changed files must execute. Left unfiltered, it demands a test for a
	// file the gate then exempts — the writer-versus-gate disagreement one step
	// further along than the write-tests fan-out.
	test('verify-tests fix: the must-execute list hands back the collected file and drops the coverage-excluded one', async () => {
		const { dir, driver, config, writerPrompts } = await setupExecutionRun({
			sources: {
				'src/feature.ts': 'export const feature = (): number => 1;\n',
				// a .tsx the positives never name, so no report can ever list it
				'src/App.tsx': 'export const App = () => <div>hi</div>;\n',
			},
			// the collected file is absent from the report, so the first attempt is red
			statements: {},
			onFix: { 'src/feature.ts': { covered: 4, total: 4 } },
			jestConfig: { collectCoverageFrom: ['src/**/*.ts'] },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md' });
		const fixPrompt = writerPrompts.find((prompt) => prompt.includes('# Verification failure'));

		expect(result.ok).toBe(true);
		expectDefined(fixPrompt);
		// the collected file is exactly what the retry has to reach...
		expect(fixPrompt.includes('# Changed internals that must execute under those tests\n\n- src/feature.ts')).toBeTruthy();
		// ...and the excluded file is out of the assignment entirely
		expect(fixPrompt.includes('src/App.tsx')).toBeFalsy();
		// it is recorded under its own name, never as an orphan
		expect(result.manifest.coverageExcludedChangedFiles).toStrictEqual(['src/App.tsx']);
		expect(result.manifest.unreachableChangedFiles).toStrictEqual([]);
	});
});

test('generate runs first in every gate set; generated prefixes earn no attribution or agent turns', async () => {
	const dir = setupConsumerRepo({
		scripts: {
			// Simulate codegen: every run rewrites a derived .ts file and logs.
			generate: `node -e "const fs=require('fs');fs.mkdirSync('src/gen',{recursive:true});fs.writeFileSync('src/gen/model.ts','export const gen = '+Date.now()+';');fs.appendFileSync('gen.log','x')"`,
		},
		config: { generated: ['src/gen/'] },
	});
	const writers: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				writers.push(prompt.match(/- (\S+)/)?.[1] ?? 'unknown');
			}

			if (role !== 'implement') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			return {
				text: report({
					changedFiles: [
						{ path: 'src/feature.js', summary: 'feature' },
						{ path: 'src/gen/model.ts', summary: 'agent even reported a generated file' },
					],
				}),
				exitCode: 0,
			};
		},
	};
	const result = await runImplementPipeline({ cwd: dir, driver, config: await readConfig({ cwd: dir }), planPath: 'plan.md' });
	const commands = readCommandLog(dir, result.manifest.runId);

	expect(result.ok).toBe(true);
	// generated file never attributed — even agent-reported
	expect(result.manifest.changedFiles.includes('src/gen/model.ts')).toBeFalsy();
	// no writer spawned for the generated .ts; the module and the caller wiring it
	// in are both the agent's work and both earn one
	expect(writers).toStrictEqual(['src/feature.js', 'src/useFeature.js']);
	// generate is the first command of the first gate set
	expect(commands[0]?.kind).toBe('generate');
	// generate ran once per gate set (clean-slate + 3 verifies; no format
	// configured)
	expect(countLog(dir, 'gen.log')).toBe(4);
	// every check is preceded by a generate
	expect(commands.every((entry, index) => entry.kind !== 'check' || commands.slice(0, index).some((prior) => prior.kind === 'generate'))).toBeTruthy();
});
