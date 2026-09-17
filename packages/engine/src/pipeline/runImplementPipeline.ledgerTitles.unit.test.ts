import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { gateResultsCommand } from '#tests/helpers/gateResultsCommand.ts';
import { report } from '#tests/helpers/report.ts';
import { reviewReport } from '#tests/helpers/reviewReport.ts';
import { roleOf } from '#tests/helpers/roleOf.ts';
import { reachabilityRulesOff, setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { withTestChangeReview } from '#tests/helpers/withTestChangeReview.ts';
import { writeSource } from '#tests/helpers/writeSource.ts';

const ledgerFile = 'src/widget.unit.test.js';
const ledgerTestName = 'widget: doubles its input';

/** The ledger's name as a real test call head — the file states the test. */
const statingBody = `test('${ledgerTestName}', () => {});\n`;

/**
 * The ledger's name everywhere a quoted-string search would find it, and
 * nowhere a test call head states it: a comment, a variable and a `describe`
 * block, over a case with another name entirely.
 */
const quotingBody = [
	`// TODO: '${ledgerTestName}'`,
	`const label = '${ledgerTestName}';`,
	`describe('${ledgerTestName}', () => {`,
	"\ttest('an older case', () => { label; });",
	'});',
	'',
].join('\n');

/** A unit suite reporting the ledger's own case as passing, so the run can prove its row. */
const ledgerTestGate = gateResultsCommand({ tests: [{ file: ledgerFile, name: ledgerTestName }] });

/**
 * The two rules asking where a test file sits are off because this fixture's
 * ledger test file has no subject module until the executor lands one — a run
 * stopped on the fixture's shape never reaches the question this suite asks.
 */
const ledgerRepoConfig = {
	'standards-checks': { ...reachabilityRulesOff['standards-checks'], 'test-in-tests-folder': 'off', 'test-not-beside-subject': 'off' },
};

/** A plan whose one-row ledger names the test file the repository already carries. */
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

interface SetupParams {
	/** What the repository has already committed at the ledger's test file path. */
	committed: string;
	/** What each ledger-writer invocation leaves on disk, in the order they are spawned. */
	passes?: string[];
}

/**
 * A consumer repo whose ledger test file is already committed, driven by a stub
 * that answers every role of a full run: the ledger writer leaves whatever the
 * case gives it, and the executor lands the module the ledger is about.
 */
const setupLedgerTitlesRun = async ({ committed, passes = [statingBody] }: SetupParams) => {
	const dir = setupConsumerRepo({
		plan: planContent,
		scripts: { test: ledgerTestGate },
		config: ledgerRepoConfig,
		sources: { 'src/index.js': 'export const one = 1;\n', [ledgerFile]: committed },
	});
	const prompts: { role: string; prompt: string }[] = [];
	let pass = 0;

	const driver: Driver = {
		name: 'stub',
		invoke: withTestChangeReview({
			invoke: async ({ prompt }) => {
				// the ledger writer is the unit-test-writer role with a different
				// assignment, so its own assignment heading is what names it
				const role = prompt.includes('# Ledger tests to write') ? 'write-ledger-tests' : roleOf(prompt);

				prompts.push({ role, prompt });

				if (role === 'standards-review') {
					return { text: reviewReport(), exitCode: 0 };
				}

				if (role === 'write-ledger-tests') {
					writeFileSync(join(dir, ledgerFile), passes[pass] ?? statingBody);
					pass += 1;

					return { text: report({ changedFiles: [{ path: ledgerFile, summary: 'ledger tests' }] }), exitCode: 0 };
				}

				if (role === 'implement') {
					writeSource({ dir, path: 'src/widget.js', source: 'export const widget = (n) => n * 2;\n' });

					return { text: report({ changedFiles: [{ path: 'src/widget.js', summary: 'module' }] }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, prompts, config: await readConfig({ cwd: dir }) };
};

/** The approved baseline the manifest carries when the writer settled on the stating body. */
const approvedStatingFile = [{ path: ledgerFile, sha256: sha256({ content: statingBody }), removed: false }];

/** The mapping the ledger seeds for this run's one row. */
const seededMapping = [{ criterion: 'a widget doubles its input', testFile: ledgerFile, testName: ledgerTestName, gate: 'test' }];

describe('runImplementPipeline', () => {
	test('write-ledger-tests: a committed file that already heads a test with the ledger’s name stops the run before any writer is paid for', async () => {
		const { dir, driver, prompts, config } = await setupLedgerTitlesRun({ committed: statingBody });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(false);
		// a test written for older behaviour cannot stand as a new criterion's
		// verifier, and the stop names the file and the name
		expect(result.error ?? '').toContain(`${ledgerFile}: ${ledgerTestName}`);
		expect(result.manifest.acceptanceTests).toStrictEqual([]);
		expect(prompts.every((entry) => entry.role !== 'write-ledger-tests')).toBeTruthy();
	});

	test('write-ledger-tests: a committed file that only quotes the ledger’s name is no conflict, because it heads no test with it', async () => {
		const { dir, driver, prompts, config } = await setupLedgerTitlesRun({ committed: quotingBody });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(true);
		// the name sits in a comment, a variable and a `describe` head, none of
		// which is a test the file already holds — so the writer is spawned once
		expect(prompts.filter((entry) => entry.role === 'write-ledger-tests').length).toBe(1);
		expect(result.manifest.acceptanceTests).toStrictEqual(seededMapping);
	});

	test('write-ledger-tests: a first pass that leaves the name quoted but heads no test with it earns one repair, and the repaired bytes are what get locked', async () => {
		const { dir, driver, prompts, config } = await setupLedgerTitlesRun({ committed: quotingBody, passes: [quotingBody, statingBody] });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const writerPrompts = prompts.filter((entry) => entry.role === 'write-ledger-tests').map((entry) => entry.prompt);

		expect(result.ok).toBe(true);
		// the presence check reads call heads, so the decoys the first pass left
		// count as the named test being absent — one repair, naming it
		expect(writerPrompts.length).toBe(2);
		expect(writerPrompts[1]).toContain('# Missing tests');
		expect(writerPrompts[1]).toContain(`- \`${ledgerTestName}\``);
		// and the approved baseline is the hash of what the repair left, not of the
		// decoys — a passing run removes the copies, and the record is the evidence
		expect(result.manifest.approvedTests).toStrictEqual(approvedStatingFile);
	});
});
