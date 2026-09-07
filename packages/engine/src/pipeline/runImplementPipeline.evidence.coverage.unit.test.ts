import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { gateResultsCommand } from '#tests/helpers/gateResultsCommand.ts';
import { report } from '#tests/helpers/report.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { verdict } from '#tests/helpers/verdict.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const ledgerFile = 'src/widget.unit.test.js';
const ledgerTestName = 'widget: doubles its input';

/**
 * The two rules asking where a test file sits are off because this fixture's
 * ledger test file is planted by an agent mid-run — a run stopped on the
 * fixture's shape never reaches the question this suite asks.
 */
const ledgerRepoConfig = {
	'standards-checks': { ...reachabilityRulesOff['standards-checks'], 'test-in-tests-folder': 'off', 'test-not-beside-subject': 'off' },
};

/** A plan carrying a one-row acceptance ledger the run has to prove. */
const planContent = [
	'# Plan: add the widget',
	'',
	'## Acceptance Tests',
	'',
	'| Criterion | Test file | Test name | Gate |',
	'| --- | --- | --- | --- |',
	`| a widget doubles its input | \`${ledgerFile}\` | ${ledgerTestName} | test |`,
	'',
].join('\n');

/** The file one ledger-writer brief names, and every test name it lists. */
const assignmentOf = ({ prompt }: { prompt: string }) => ({
	path: /Write these tests, and only these, in `([^`]+)`/.exec(prompt)?.[1] ?? '',
	names: [...prompt.matchAll(/test name: `([^`]+)`/g)].map(([, name]) => name),
});

/**
 * A consumer repo whose unit suite reports one case that is not the one the
 * ledger names, and whose two earlier checkpoints are overridden down to the
 * cheap gate — so the row's gate runs at the refactor checkpoint and nowhere
 * else, which is what makes "which checkpoint is the last one" observable.
 *
 * The refactor steps are left on: this run's last verification is
 * `verify-refactor`, not `verify-tests`.
 */
const setupRefactorEvidenceRun = async () => {
	const dir = setupConsumerRepo({
		plan: planContent,
		scripts: { test: gateResultsCommand({ tests: [{ file: 'src/other.unit.test.js', name: 'other: is unrelated' }] }) },
		config: { ...ledgerRepoConfig, 'gate-overrides': { 'verify-implement': ['check'], 'verify-tests': ['check'] } },
	});
	const progress: string[] = [];

	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				// the ledger writer is the unit-test-writer role with a different
				// assignment, so its own assignment heading is what names it
				const role = prompt.includes('# Ledger tests to write') ? 'write-ledger-tests' : roleOf(prompt);

				if (role === 'supervisor') {
					return { text: verdict(), exitCode: 0 };
				}

				if (role === 'write-ledger-tests') {
					const { path, names } = assignmentOf({ prompt });

					writeFileSync(join(dir, path), `${names.map((name) => `test('${name}', () => {});`).join('\n')}\n`);

					return { text: report({ changedFiles: [{ path, summary: 'ledger tests' }] }), exitCode: 0 };
				}

				if (role === 'implement') {
					writeSource({ dir, path: 'src/widget.js', source: 'export const widget = (n) => n * 2;\n' });

					return { text: report({ changedFiles: [{ path: 'src/widget.js', summary: 'module' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, progress, config: await readConfig({ cwd: dir }), onProgress: (message: string) => progress.push(message) };
};

describe('runImplementPipeline', () => {
	test('implement: holds the acceptance row to the refactor checkpoint when the refactor steps run', async () => {
		const { dir, driver, config, progress, onProgress } = await setupRefactorEvidenceRun();

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', onProgress });

		const stepStatus = ({ id }: { id: string }) => result.manifest.steps.find((step) => step.id === id)?.status;

		expect(result.ok).toBe(false);
		// the row's gate never ran at either earlier checkpoint, so both narrate the
		// row and pass — a red there would blame the run for a schedule it was given
		expect(stepStatus({ id: 'verify-implement' })).toBe('passed');
		expect(stepStatus({ id: 'verify-tests' })).toBe('passed');
		expect(progress.some((line) => line.includes(ledgerTestName))).toBeTruthy();
		// and the last verification is the refactor one, which is where a row no
		// gate ever proved has to go red against the finished tree
		expect(stepStatus({ id: 'verify-refactor' })).toBe('escalated');
		expect(result.manifest.steps.find((step) => step.id === 'verify-refactor')?.verification).toEqual(
			expect.objectContaining({ failedFamilies: ['acceptance-tests'] }),
		);
		expect(result.error ?? '').toContain(ledgerTestName);
		expect(result.error ?? '').toContain(ledgerFile);
	});
});
