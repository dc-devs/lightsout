import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

/** A plan that declares its own touched-file allowance in the optional `## File Budget` section. */
const planWithBudget = ({ fileBudget }: { fileBudget: number }) => `# Plan: add feature\n\n## File Budget\n\n${fileBudget}\n`;

/**
 * The number the executor's stop rule was assembled with. Read back out of the
 * role prompt by the digits in the rule rather than by the whole sentence, so
 * the assertion pins the limit — the engine-owned value — and not the wording
 * around it.
 */
const stopRuleLimit = ({ systemPrompt }: { systemPrompt: string | undefined }) => /more than (\d+) source files/.exec(systemPrompt ?? '')?.[1];

interface SetupParams {
	/** Plan text, replacing the repo's default plan — this is where a `## File Budget` is declared. */
	plan?: string;
	/** Extra config fields, e.g. `{ 'executor-file-limit': 12 }`. */
	config?: Record<string, unknown>;
	/** Make the unit gate refuse the moment implement lands, so verify-implement buys a fix re-invocation. */
	redGate?: boolean;
}

/**
 * A consumer repo whose stub driver records the first system prompt each role
 * was invoked with. `redGate` plants a marker file the `test` gate refuses, so
 * the run walks into verify-implement's fix re-invocation instead of finishing
 * green — that call site builds its own executor invocation and has to carry
 * the same limit as the first one.
 */
const setupFileLimitRun = async ({ plan, config: configFields, redGate }: SetupParams = {}) => {
	const dir = setupConsumerRepo({ plan, config: configFields, scripts: redGate ? { test: 'test ! -f BROKEN' } : undefined });
	const systemPrompts: Record<string, string | undefined> = {};

	const driver: Driver = {
		name: 'stub',
		invoke: async ({ prompt, systemPrompt }) => {
			const role = roleOf(prompt);

			if (role === 'standards-review') {
				return { text: reviewReport(), exitCode: 0 };
			}

			systemPrompts[role] ??= systemPrompt;

			if (role === 'supervisor') {
				return { text: verdict(), exitCode: 0 };
			}

			if (role === 'write-tests') {
				mkdirSync(join(dir, 'test'), { recursive: true });
				writeFileSync(join(dir, 'test/feature.test.js'), '// stub\n');

				return { text: report({ changedFiles: [{ path: 'test/feature.test.js', summary: 'tests' }] }), exitCode: 0 };
			}

			if (role === 'refactor' || role === 'fix') {
				return { text: report(), exitCode: 0 };
			}

			writeSource({ dir, path: 'src/feature.js', source: 'export const feature = () => 2;\n' });

			if (redGate) {
				writeFileSync(join(dir, 'BROKEN'), 'x');
			}

			return { text: report({ changedFiles: [{ path: 'src/feature.js', summary: 'feature' }] }), exitCode: 0 };
		},
	};

	return { dir, driver, systemPrompts, config: await readConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test("the plan's own File Budget is the executor's stop, over a configured limit", async () => {
		const { dir, driver, systemPrompts, config } = await setupFileLimitRun({
			plan: planWithBudget({ fileBudget: 200 }),
			config: { 'executor-file-limit': 12 },
		});

		await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(stopRuleLimit({ systemPrompt: systemPrompts.implement })).toBe('200');
		// substitution happens as the invocation is assembled, so no agent ever
		// sees the template's token
		expect(systemPrompts.implement).not.toContain('{{fileLimit}}');
	});

	test('a plan declaring no budget is held to executor-file-limit', async () => {
		const { dir, driver, systemPrompts, config } = await setupFileLimitRun({ config: { 'executor-file-limit': 12 } });

		await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(stopRuleLimit({ systemPrompt: systemPrompts.implement })).toBe('12');
	});

	test('neither a budget nor a configured limit falls back to the default', async () => {
		const { dir, driver, systemPrompts, config } = await setupFileLimitRun();

		await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(stopRuleLimit({ systemPrompt: systemPrompts.implement })).toBe('50');
	});

	test("the verify-implement fix re-invocation is held to the plan's budget too", async () => {
		const { dir, driver, systemPrompts, config } = await setupFileLimitRun({ plan: planWithBudget({ fileBudget: 200 }), redGate: true });

		await runImplementPipeline({ cwd: dir, planPath: 'plan.md', driver, config });

		expect(stopRuleLimit({ systemPrompt: systemPrompts.fix })).toBe('200');
	});
});
