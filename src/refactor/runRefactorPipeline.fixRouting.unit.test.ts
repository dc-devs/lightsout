import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { linkTypescript } from '@tests/helpers/linkTypescript';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { setupMonorepo } from '@tests/helpers/setupMonorepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alpha = 1;\nexport const beta = 2;\n';

/** An over-cap function body — the size rule's advisory, which needs the AST tier. */
const bigFunction = `export const big = () => {\n${Array.from({ length: 85 }, (_, index) => `\tconst v${index} = ${index};`).join('\n')}\n\treturn v0;\n};\n`;

const commitAll = (dir: string) => execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm fixture', { cwd: dir });

/**
 * A whole-repo refactor run over one multi-export finding whose executor
 * resolves the finding and then trips exactly one gate, by planting `flag`.
 * The gate that goes red is the one whose command watches for that flag, so a
 * run can be arranged with a coverage-only red or a check-only red. Every fix
 * re-invocation clears the flag, so the run ends green whichever role the
 * routing picked — the recorded prompts are the evidence, not the outcome.
 */
const setupSingleGateRed = async ({ gate, flag }: { gate: 'check' | 'testCoverage'; flag: string }) => {
	const dir = setupConsumerRepo({ scripts: { [gate]: `test ! -f ${flag}` } });

	writeFileSync(join(dir, 'src/multi.ts'), multiExport);
	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			prompts.push(prompt);

			if (prompt.includes('# Verification failure')) {
				rmSync(join(dir, flag), { force: true });

				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'src/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'src/beta.ts'), 'export const beta = 2;\n');
			writeFileSync(join(dir, flag), 'red\n');

			return { text: report({ changedFiles: [{ path: 'src/multi.ts', summary: 'split' }, { path: 'src/beta.ts', summary: 'split' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }), prompts };
};

/** A scoped gate command that exits red only for `pkg`, and only while `flag` exists. */
const packageGateCommand = ({ pkg, flag }: { pkg: string; flag: string }) =>
	`node -e "process.exit(process.argv[1] === '${pkg}' && require('fs').existsSync('${flag}') ? 1 : 0)" {package}`;

/**
 * The mixed-red arrangement: a monorepo whose scoped gates put a check red on
 * one package and a coverage red on another, so a single batch's gate output
 * carries both kinds at once. The executor touches both packages (that is what
 * puts both in gate scope) and plants both flags; the fix clears them.
 */
const setupMixedRed = async () => {
	const dir = setupMonorepo();

	writeFileSync(
		join(dir, 'lightsout.config.json'),
		JSON.stringify({
			scripts: { check: 'true', testUnit: 'true', testCoverage: 'true' },
			packageScripts: {
				check: packageGateCommand({ pkg: '@acme/api', flag: 'check.flag' }),
				testUnit: 'node -e "process.exit(0)" {package}',
				testCoverage: packageGateCommand({ pkg: '@acme/web', flag: 'coverage.flag' }),
			},
		}),
	);
	writeFileSync(join(dir, 'packages/api/src/multi.ts'), multiExport);
	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			prompts.push(prompt);

			if (prompt.includes('# Verification failure')) {
				rmSync(join(dir, 'check.flag'), { force: true });
				rmSync(join(dir, 'coverage.flag'), { force: true });

				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'packages/api/src/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'packages/api/src/beta.ts'), 'export const beta = 2;\n');
			writeFileSync(join(dir, 'packages/web/src/touched.ts'), 'export const touched = 1;\n');
			writeFileSync(join(dir, 'check.flag'), 'red\n');
			writeFileSync(join(dir, 'coverage.flag'), 'red\n');

			return {
				text: report({
					changedFiles: [
						{ path: 'packages/api/src/multi.ts', summary: 'split' },
						{ path: 'packages/api/src/beta.ts', summary: 'split' },
						{ path: 'packages/web/src/touched.ts', summary: 'touched' },
					],
				}),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }), prompts };
};

/**
 * A check-red run whose finding file ALSO carries an over-cap function, so the
 * fix invocation has both kinds to carry: the batch's frozen findings and the
 * size advisories the pre-batch check recomputed live. The AST tier the size
 * rule needs is why typescript is linked into the temp repo.
 */
const setupAdvisoryGateRed = async () => {
	const dir = setupConsumerRepo({ scripts: { check: 'test ! -f check.flag' } });

	linkTypescript({ dir });
	mkdirSync(join(dir, 'alpha'), { recursive: true });
	writeFileSync(join(dir, 'alpha/multi.ts'), `export const alpha = 1;\n${bigFunction}`);
	commitAll(dir);

	const prompts: string[] = [];
	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt }) => {
			prompts.push(prompt);

			if (prompt.includes('# Verification failure')) {
				rmSync(join(dir, 'check.flag'), { force: true });

				return { text: report(), exitCode: 0 };
			}

			writeFileSync(join(dir, 'alpha/multi.ts'), 'export const alpha = 1;\n');
			writeFileSync(join(dir, 'alpha/beta.ts'), 'export const beta = 2;\n');
			writeFileSync(join(dir, 'check.flag'), 'red\n');

			return {
				text: report({ changedFiles: [{ path: 'alpha/multi.ts', summary: 'split' }, { path: 'alpha/beta.ts', summary: 'split' }] }),
				exitCode: 0,
			};
		},
	};

	return { dir, driver, config: await loadConfig({ cwd: dir }), prompts };
};

/** The first fix re-invocation's prompt — the one carrying the red gate output. */
const fixPromptOf = (prompts: string[]) => prompts.find((prompt) => prompt.includes('# Verification failure'));

describe('buildBatchFixInvocation — via runRefactorPipeline', () => {
	test('routes a coverage-only red to the test writer', async () => {
		const { dir, driver, config, prompts } = await setupSingleGateRed({ gate: 'testCoverage', flag: 'coverage.flag' });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts);

		expect(result.ok).toBe(true);
		// the red coverage gate forced a fix invocation, got roles:
		// ${prompts.map(roleOf).join(', ')}
		expect(fixPrompt).toBeTruthy();
		// coverage is the only red — the missing tests are the work, so the test
		// writer gets it
		expect(roleOf(fixPrompt ?? '')).toBe('write-tests');
		// the red gate output rides the fix invocation as its error context
		expect(fixPrompt).toContain('test-coverage failed');
	});

	test('routes a non-coverage red back to the refactor executor', async () => {
		const { dir, driver, config, prompts } = await setupSingleGateRed({ gate: 'check', flag: 'check.flag' });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts);

		expect(result.ok).toBe(true);
		// the red check gate forced a fix invocation, got roles:
		// ${prompts.map(roleOf).join(', ')}
		expect(fixPrompt).toBeTruthy();
		// a red check gate is the refactor pass breaking its own tree — the executor
		// fixes it, not the test writer
		expect(roleOf(fixPrompt ?? '')).toBe('refactor');
		// the red gate output rides the fix invocation as its error context
		expect(fixPrompt).toContain('check failed');
	});

	test('routes a coverage red mixed with another kind to the refactor executor', async () => {
		const { dir, driver, config, prompts } = await setupMixedRed();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts);

		expect(result.ok).toBe(true);
		// the mixed red forced a fix invocation, got roles:
		// ${prompts.map(roleOf).join(', ')}
		expect(fixPrompt).toBeTruthy();
		// the arrangement must produce both gate kinds in one error
		expect(fixPrompt).toContain('check failed');
		expect(fixPrompt).toContain('test-coverage failed');
		// the coverage red may be downstream of the source break — the source is fixed
		// first
		expect(roleOf(fixPrompt ?? '')).toBe('refactor');
	});

	test('carries the batch’s findings into the refactor executor’s fix invocation', async () => {
		const { dir, driver, config, prompts } = await setupSingleGateRed({ gate: 'check', flag: 'check.flag' });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts) ?? '';

		expect(result.ok).toBe(true);
		// a fix pass is not a bare gate-error handoff — the work-list rides it under
		// the heading the executor's role prompt names, or the executor re-fixes blind
		// to what it was sent to resolve
		expect(fixPrompt).toContain('# Standards findings (deterministic checks)');
		expect(fixPrompt).toMatch(/- \[structure] src\/multi\.ts/);
	});

	test('carries the live size advisories into the refactor executor’s fix invocation', async () => {
		const { dir, driver, config, prompts } = await setupAdvisoryGateRed();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts) ?? '';

		expect(result.ok).toBe(true);
		// the advisories the pre-batch check recomputed ride the fix pass beside the
		// findings, so the second pass judges the same context the first one did
		expect(fixPrompt).toMatch(/- \[size] alpha\/multi\.ts:\d+/);
	});
});
