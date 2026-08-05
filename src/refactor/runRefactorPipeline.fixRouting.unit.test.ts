import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { Driver } from '@/drivers';
import { loadConfig } from '@/common/utils/loadConfig';
import { runRefactorPipeline } from '@/refactor';
import { report } from '@tests/helpers/report';
import { roleOf } from '@tests/helpers/roleOf';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';
import { setupMonorepo } from '@tests/helpers/setupMonorepo';

/** Two exported consts in one file — a compiler-free structure Finding (multi-export). */
const multiExport = 'export const alpha = 1;\nexport const beta = 2;\n';

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

/** The first fix re-invocation's prompt — the one carrying the red gate output. */
const fixPromptOf = (prompts: string[]) => prompts.find((prompt) => prompt.includes('# Verification failure'));

describe('buildBatchFixInvocation — via runRefactorPipeline', () => {
	test('routes a coverage-only red to the test writer', async () => {
		const { dir, driver, config, prompts } = await setupSingleGateRed({ gate: 'testCoverage', flag: 'coverage.flag' });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts);

		assert.equal(result.ok, true, result.error);
		assert.ok(fixPrompt, `the red coverage gate forced a fix invocation, got roles: ${prompts.map(roleOf).join(', ')}`);
		assert.equal(roleOf(fixPrompt), 'write-tests', 'coverage is the only red — the missing tests are the work, so the test writer gets it');
		assert.ok(fixPrompt.includes('test-coverage failed'), 'the red gate output rides the fix invocation as its error context');
	});

	test('routes a non-coverage red back to the refactor executor', async () => {
		const { dir, driver, config, prompts } = await setupSingleGateRed({ gate: 'check', flag: 'check.flag' });

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts);

		assert.equal(result.ok, true, result.error);
		assert.ok(fixPrompt, `the red check gate forced a fix invocation, got roles: ${prompts.map(roleOf).join(', ')}`);
		assert.equal(roleOf(fixPrompt), 'refactor', 'a red check gate is the refactor pass breaking its own tree — the executor fixes it, not the test writer');
		assert.ok(fixPrompt.includes('check failed'), 'the red gate output rides the fix invocation as its error context');
	});

	test('routes a coverage red mixed with another kind to the refactor executor', async () => {
		const { dir, driver, config, prompts } = await setupMixedRed();

		const result = await runRefactorPipeline({ cwd: dir, driver, config });

		const fixPrompt = fixPromptOf(prompts);

		assert.equal(result.ok, true, result.error);
		assert.ok(fixPrompt, `the mixed red forced a fix invocation, got roles: ${prompts.map(roleOf).join(', ')}`);
		assert.ok(
			fixPrompt.includes('check failed') && fixPrompt.includes('test-coverage failed'),
			`the arrangement must produce both gate kinds in one error, got: ${fixPrompt}`,
		);
		assert.equal(roleOf(fixPrompt), 'refactor', 'the coverage red may be downstream of the source break — the source is fixed first');
	});
});
