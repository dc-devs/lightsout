import { mkdirSync, writeFileSync } from 'node:fs';
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

// What the run does with the plan's acceptance ledger from end to end: the
// mapping it seeds, the baseline it approves, and which briefs are told what
// this run means by done. The review itself is the suite beside this one.

const widgetCriterion = 'a widget doubles its input';
const widgetFile = 'src/widget.unit.test.js';
const widgetTestName = 'widget: doubles its input';

const gadgetCriterion = 'a gadget renders its label';
const gadgetFile = 'src/gadget.unit.test.js';
const gadgetTestName = 'gadget: renders its label';

const widgetRow = `| ${widgetCriterion} | \`${widgetFile}\` | ${widgetTestName} | test |`;
const gadgetRow = `| ${gadgetCriterion} | \`${gadgetFile}\` | ${gadgetTestName} | test |`;

/** A test file stating exactly the named cases — what a ledger writer leaves on disk. */
const bodyOf = ({ names }: { names: string[] }) => `${names.map((name) => `test('${name}', () => {});`).join('\n')}\n`;

/** The source modules the executor lands, by repo-relative path. */
const widgetModule = { 'src/widget.js': 'export const widget = (n) => n * 2;\n' };
const gadgetModule = { 'src/gadget.js': "export const gadget = () => 'label';\n" };

/**
 * The two rules asking where a test file sits are off because this fixture's
 * ledger test files are planted by an agent mid-run — a run stopped on the
 * fixture's shape never reaches the question this suite asks.
 */
const ledgerRepoConfig = {
	'standards-checks': { ...reachabilityRulesOff['standards-checks'], 'test-in-tests-folder': 'off', 'test-not-beside-subject': 'off' },
};

/** A plan whose `## Acceptance Tests` table holds the given rows. */
const planWith = ({ rows }: { rows: string[] }) =>
	['# Plan: add the widget', '', '## Acceptance Tests', '', '| Criterion | Test file | Test name | Gate |', '| --- | --- | --- | --- |', ...rows, ''].join(
		'\n',
	);

/** The file one ledger-writer brief names, and every test name it lists. */
const assignmentOf = ({ prompt }: { prompt: string }) => ({
	path: /Write these tests, and only these, in `([^`]+)`/.exec(prompt)?.[1] ?? '',
	names: [...prompt.matchAll(/test name: `([^`]+)`/g)].map(([, name]) => name),
});

/** The bullet the shared acceptance-tests section emits for one row. */
const rowBullet = ({ testFile, testName }: { testFile: string; testName: string }) => `- \`${testName}\` in ${testFile}`;

interface SetupParams {
	/** The plan the run is given. */
	plan: string;
	/** Source modules the executor lands, by repo-relative path. */
	implemented?: Record<string, string>;
	/** The per-test evidence the unit suite leaves behind. Omitted, the gate reports nothing and the plan names no row to prove. */
	evidence?: { file: string; name: string }[];
	/** True when the harness rate-limits the ledger writer instead of letting it answer. */
	parkLedgerWriter?: boolean;
}

/**
 * A consumer repo driven by a stub that answers every seat of a full run: the
 * ledger writer plants exactly the tests its brief names, the executor lands the
 * modules the ledger is about, the coverage writer leaves a test file of its
 * own, and the test-change reviewer approves whatever the bundle holds.
 *
 * The reviewer is answered by the shared helper rather than by this fixture,
 * because what it rules is the neighbouring suite's subject: here it must simply
 * not be the thing that stops the run.
 */
const setupLedgerRun = async ({ plan, implemented = widgetModule, evidence, parkLedgerWriter = false }: SetupParams) => {
	const dir = setupConsumerRepo({
		plan,
		config: ledgerRepoConfig,
		...(evidence ? { scripts: { test: gateResultsCommand({ tests: evidence }) } } : {}),
	});
	const prompts: { role: string; prompt: string }[] = [];

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
					if (parkLedgerWriter) {
						return { text: '', exitCode: 1, rateLimited: true };
					}

					const { path, names } = assignmentOf({ prompt });

					writeFileSync(join(dir, path), bodyOf({ names }));

					return { text: report({ changedFiles: [{ path, summary: 'ledger tests' }] }), exitCode: 0 };
				}

				if (role === 'write-tests') {
					mkdirSync(join(dir, 'test'), { recursive: true });
					writeFileSync(join(dir, 'test/coverage.test.js'), '// stub test\n');

					return { text: report({ changedFiles: [{ path: 'test/coverage.test.js', summary: 'coverage tests' }] }), exitCode: 0 };
				}

				if (role === 'implement') {
					for (const [path, source] of Object.entries(implemented)) {
						writeSource({ dir, path, source });
					}

					return { text: report({ changedFiles: Object.keys(implemented).map((path) => ({ path, summary: 'module' })) }), exitCode: 0 };
				}

				return { text: report(), exitCode: 0 };
			},
		}),
	};

	return { dir, driver, prompts, config: await readConfig({ cwd: dir }) };
};

describe('runImplementPipeline', () => {
	test("write-ledger-tests: the ledger's tests are written before the executor is briefed, and the brief names every row it has to satisfy", async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({
			plan: planWith({ rows: [widgetRow] }),
			evidence: [{ file: widgetFile, name: widgetTestName }],
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const implementPrompt = prompts.find((entry) => entry.role === 'implement')?.prompt ?? '';

		expect(result.ok).toBe(true);
		// the tests that define done are written first — before the party they judge
		// has been asked for anything
		expect(prompts[0]?.role).toBe('write-ledger-tests');
		expect(prompts[0]?.prompt).toContain(`Write these tests, and only these, in \`${widgetFile}\``);
		// and the executor is told which test it has to leave passing, by file and
		// by name. It may edit that file now, so the brief carries the rule the
		// reviewer enforces instead of the old read-only bar.
		expect(implementPrompt).toContain(rowBullet({ testFile: widgetFile, testName: widgetTestName }));
		expect(implementPrompt).toContain('Every edit to a test file is reviewed against the plan before any gate runs.');
	});

	test('write-ledger-tests: every test file the ledger names gets its own writer and its own approved record', async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({
			plan: planWith({ rows: [widgetRow, gadgetRow] }),
			implemented: { ...widgetModule, ...gadgetModule },
			evidence: [
				{ file: widgetFile, name: widgetTestName },
				{ file: gadgetFile, name: gadgetTestName },
			],
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const approvedOf = ({ path }: { path: string }) => result.manifest.approvedTests.find((record) => record.path === path);

		expect(result.ok).toBe(true);
		// one writer per file, so no file's cases are written by an agent briefed
		// about another file's criteria
		expect(prompts.filter((entry) => entry.role === 'write-ledger-tests').length).toBe(2);
		// each file's own bytes are the baseline the first checkpoint diffs against,
		// recorded under its own repo-relative path
		expect({ widget: approvedOf({ path: widgetFile }), gadget: approvedOf({ path: gadgetFile }) }).toStrictEqual({
			widget: { path: widgetFile, sha256: sha256({ content: bodyOf({ names: [widgetTestName] }) }), removed: false },
			gadget: { path: gadgetFile, sha256: sha256({ content: bodyOf({ names: [gadgetTestName] }) }), removed: false },
		});
		// and the live mapping opens with one row per ledger row, criterion and gate
		// carried, which is what every later checkpoint proves
		expect(result.manifest.acceptanceTests).toStrictEqual([
			{ criterion: widgetCriterion, testFile: widgetFile, testName: widgetTestName, gate: 'test' },
			{ criterion: gadgetCriterion, testFile: gadgetFile, testName: gadgetTestName, gate: 'test' },
		]);
	});

	test("write-tests: the run's acceptance rows reach every coverage writer's brief", async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({
			plan: planWith({ rows: [widgetRow] }),
			evidence: [{ file: widgetFile, name: widgetTestName }],
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const writerPrompts = prompts.filter((entry) => entry.role === 'write-tests').map((entry) => entry.prompt);

		expect(result.ok).toBe(true);
		// a coverage writer edits test files for a living, so every one of them is
		// told which cases the run has to leave passing — not just the first
		expect(writerPrompts.length).toBeGreaterThan(0);
		expect(writerPrompts.every((prompt) => prompt.includes(rowBullet({ testFile: widgetFile, testName: widgetTestName })))).toBe(true);
	});

	test('write-ledger-tests: a plan carrying no ledger records why it was skipped and briefs no acceptance section', async () => {
		const { dir, driver, prompts, config } = await setupLedgerRun({ plan: '# Plan: add the widget\n' });

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		const skipped = result.manifest.steps.find((record) => record.id === 'write-ledger-tests');

		expect(result.ok).toBe(true);
		// the manifest explains the whole run, including the part that did not happen
		expect(skipped?.report).toEqual(expect.objectContaining({ skipped: 'the plan carries no acceptance-test ledger' }));
		// nothing states what done means, so the mapping stays empty and the section
		// is omitted from every brief rather than emitted with no rows under it
		expect(result.manifest.acceptanceTests).toStrictEqual([]);
		expect(prompts.every((entry) => !entry.prompt.includes('# Acceptance tests'))).toBe(true);
	});

	test('write-ledger-tests: a rate-limited ledger writer parks the run with nothing approved', async () => {
		// the ledger's gate has to write per-test evidence, or clean-slate refuses
		// the run before a writer is ever spawned and the park never happens
		const { dir, driver, prompts, config } = await setupLedgerRun({
			plan: planWith({ rows: [widgetRow] }),
			evidence: [{ file: widgetFile, name: widgetTestName }],
			parkLedgerWriter: true,
		});

		const result = await runImplementPipeline({ cwd: dir, driver, config, planPath: 'plan.md', skipRefactor: true });

		expect(result.ok).toBe(false);
		expect(result.manifest.status).toBe('paused-rate-limit');
		// a half-written ledger approves nothing and seeds no mapping, so the
		// resumed run writes it from the top rather than against a baseline that
		// only covers the files the parked pass happened to reach
		expect(result.manifest.approvedTests).toStrictEqual([]);
		expect(result.manifest.acceptanceTests).toStrictEqual([]);
		// and no executor was paid for against tests that do not exist yet
		expect(prompts.every((entry) => entry.role !== 'implement')).toBe(true);
	});
});
