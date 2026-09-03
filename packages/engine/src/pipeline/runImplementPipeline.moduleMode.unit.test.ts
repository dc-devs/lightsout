import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { expectDefined } from '#tests/helpers/expectDefined.ts';
import { linkTypescript } from '#tests/helpers/linkTypescript.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';

// A module-scope `await` is a syntax error only where the runner evaluates the
// file as CommonJS. The write-tests fan-out and the changed-file execution gate
// both ask that one question, so the repo's own Jest configuration has to move
// them together: one key in jest.config.cjs decides whether the file earns a
// test writer AND whether the gate holds it to the executed bar. These runs
// keep the fixture identical and flip only that key.

const awaitingFile = 'src/boot.ts';
const plainFile = 'src/add.ts';

const sources = {
	// a module-scope await — legal ES module, syntax error under CommonJS
	[awaitingFile]: 'const load = async (): Promise<number> => 1;\n\nexport const boot = await load();\n',
	[plainFile]: 'export const add = (a: number, b: number): number => a + b;\n',
};

/**
 * The files the write-tests fan-out handed to writers, read off the prompts'
 * subject lists. Taken from the prompts rather than counted per invocation,
 * because how many writers the subjects were grouped into is not what these
 * tests are about — which files earned one is.
 */
const subjectsOf = ({ prompts }: { prompts: string[] }) =>
	prompts.flatMap((prompt) => [...(prompt.split('# Changed internals')[0] ?? '').matchAll(/^- (\S+)$/gm)].map(([, file]) => file)).sort();

/**
 * A consumer repo whose coverage gate is a no-op command over a summary this
 * test writes by hand, plus a real jest.config.cjs the engine reads to learn
 * the module mode. The summary reports the awaiting file as never executed, so
 * the gate's verdict on it is visible in the run's own outcome.
 */
const setupModuleModeRun = async ({ jestConfig }: { jestConfig: Record<string, unknown> }) => {
	const dir = setupConsumerRepo({ scripts: { 'test-coverage': 'true' }, config: reachabilityRulesOff });

	linkTypescript({ dir });
	writeFileSync(join(dir, 'jest.config.cjs'), `module.exports = ${JSON.stringify(jestConfig)};\n`);
	mkdirSync(join(dir, 'coverage'), { recursive: true });
	writeFileSync(
		join(dir, 'coverage', 'coverage-summary.json'),
		JSON.stringify({
			total: { statements: { pct: 100, covered: 10, total: 10 } },
			[join(dir, plainFile)]: { statements: { pct: 100, covered: 3, total: 3 } },
			[join(dir, awaitingFile)]: { statements: { pct: 0, covered: 0, total: 3 } },
		}),
	);

	const writerPrompts: string[] = [];
	const progress: string[] = [];
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
				// the verify fix re-invocation is a different assignment; only the
				// fan-out's own prompts say which files earned a writer
				if (!prompt.includes('# Verification failure')) {
					writerPrompts.push(prompt);
				}

				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			for (const [path, content] of Object.entries(sources)) {
				writeFileSync(join(dir, path), content);
			}

			return { text: report({ changedFiles: Object.keys(sources).map((path) => ({ path, summary: 'source' })) }), exitCode: 0 };
		},
	};

	return {
		dir,
		driver,
		config: await readConfig({ cwd: dir }),
		writerPrompts,
		progress,
		onProgress: (message: string) => progress.push(message),
	};
};

describe('runImplementPipeline', () => {
	test('write-tests: a module-scope-await file is skipped when the repo’s Jest loads it as CommonJS, and the execution gate exempts it too', async () => {
		const { dir, driver, config, writerPrompts, progress, onProgress } = await setupModuleModeRun({ jestConfig: {} });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });

		const skipped = progress.find((line) => line.includes('no unit test could move their coverage'));

		expectDefined(skipped);
		// no writer was asked for a test of a file this repo's Jest cannot load
		expect(subjectsOf({ prompts: writerPrompts })).toStrictEqual(['src/add.ts']);
		// and the skip is narrated with the condition, not an unconditional claim
		expect(skipped).toContain(awaitingFile);
		expect(skipped).toContain('Jest loads as CommonJS');
		// the gate agreed: the file is absent from the summary's executed counts,
		// yet the run still reaches a passing verdict
		expect(result.ok).toBe(true);
	});

	test('write-tests: the same file earns a writer when extensionsToTreatAsEsm makes the repo’s Jest load it as an ES module', async () => {
		const { dir, driver, config, writerPrompts, progress, onProgress } = await setupModuleModeRun({
			jestConfig: { extensionsToTreatAsEsm: ['.ts'] },
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });

		// the module-scope await no longer costs the file its writer
		expect(subjectsOf({ prompts: writerPrompts })).toStrictEqual(['src/add.ts', 'src/boot.ts']);
		// nothing was narrated as uncoverable, because nothing was
		expect(progress.some((line) => line.includes('no unit test could move their coverage'))).toBe(false);
		// and the gate moved with the writer selection: the file is held to the
		// executed bar like any other, so the untouched summary now fails the run
		expect(result.ok).toBe(false);
		expect(result.error ?? '').toContain(`changed-file-execution: 1 changed file(s) never executed under the tests: ${awaitingFile}`);
	});
});
