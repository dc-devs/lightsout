import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, jest, test } from '@jest/globals';
import type { GateResult } from '#src/contracts/index.ts';
import { checkAcceptanceTests } from '#src/gates/testResults/checkAcceptanceTests.ts';

/** One assertion result as the runner reported it, under the repo-relative test file it belongs to. */
interface Assertion {
	file: string;
	title: string;
	/** The describe blocks around it; they make up the reported full name. */
	ancestorTitles?: string[];
	/** Defaults to 'passed'. */
	status?: string;
}

interface GateSpec {
	/** The gate family a result records: 'check', 'test', 'testCoverage', or a custom suite's own name. */
	kind: string;
	/** Defaults to the root group. */
	group?: string;
	/** Defaults to 0. */
	exitCode?: number;
	skipped?: true;
	/** Omitted, this execution recorded no results directory at all. */
	assertions?: Assertion[];
}

/** Every status the engine must read as "not passing", including one it has never heard of. */
const notPassingStatuses = ['failed', 'pending', 'skipped', 'todo', 'disabled', 'focused', 'errored'];

// One results file exactly as the reporter writes it: absolute test file paths,
// so the reader's re-relativising is exercised rather than bypassed.
const buildResultsFile = ({ cwd, assertions }: { cwd: string; assertions: Assertion[] }) => ({
	testResults: Array.from(new Set(assertions.map(({ file }) => file))).map((file) => ({
		testFilePath: join(cwd, file),
		assertionResults: assertions
			.filter((assertion) => assertion.file === file)
			.map(({ title, ancestorTitles = [], status = 'passed' }) => ({
				title,
				ancestorTitles,
				fullName: [...ancestorTitles, title].join(' '),
				status,
				durationMs: 1,
			})),
	})),
});

const setupGates = ({ gates }: { gates: GateSpec[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-acceptance-'));

	const results: GateResult[] = gates.map(({ kind, group = 'root', exitCode = 0, skipped, assertions }, index) => {
		const base: GateResult = skipped
			? { kind, group, command: `run ${kind}`, skipped, reason: `no "${kind}" script` }
			: { kind, group, command: `run ${kind}`, exitCode };

		if (assertions === undefined) {
			return base;
		}

		const testResultsDir = join('.lightsout', 'runs', 'run-1', 'test-results', 'verify-tests', group, kind);

		mkdirSync(join(cwd, testResultsDir), { recursive: true });
		writeFileSync(join(cwd, testResultsDir, `jest-${index}.json`), JSON.stringify(buildResultsFile({ cwd, assertions })));

		return { ...base, testResultsDir };
	});

	return { cwd, results };
};

test('checkAcceptanceTests: passes a row when every matching case passed and fails it on no match or a failing match', async () => {
	const { cwd, results } = setupGates({
		gates: [
			{
				kind: 'test',
				assertions: [
					{ file: 'src/proved.unit.test.ts', title: 'proved: states the behaviour' },
					{ file: 'src/missing.unit.test.ts', title: 'missing: some entirely other case' },
					{ file: 'src/red.unit.test.ts', title: 'red: states the behaviour', status: 'failed' },
				],
			},
		],
	});

	const error = await checkAcceptanceTests({
		cwd,
		rows: [
			{ testFile: 'src/proved.unit.test.ts', testName: 'proved: states the behaviour', gate: 'test' },
			{ testFile: 'src/missing.unit.test.ts', testName: 'missing: states the behaviour', gate: 'test' },
			{ testFile: 'src/red.unit.test.ts', testName: 'red: states the behaviour', gate: 'test' },
		],
		gates: results,
		final: false,
		packagesDir: 'packages',
	});

	expect(error).toEqual(expect.stringContaining('acceptance-tests'));
	expect(error).toContain('src/missing.unit.test.ts');
	expect(error).toContain('src/red.unit.test.ts');
	expect(error).not.toContain('src/proved.unit.test.ts');
});

test('checkAcceptanceTests: proves a literal name that jest expanded under a describe.each ancestor by every expansion passing', async () => {
	// One literal `test` under a describe.each: jest reports one assertion per
	// table row, same title, differing full name.
	const { cwd, results } = setupGates({
		gates: [
			{
				kind: 'test',
				assertions: [
					{ file: 'src/runGates.flake.unit.test.ts', title: 'runGates: re-runs a crashed worker', ancestorTitles: ['for a unit suite'] },
					{ file: 'src/runGates.flake.unit.test.ts', title: 'runGates: re-runs a crashed worker', ancestorTitles: ['for an e2e suite'] },
				],
			},
		],
	});

	const error = await checkAcceptanceTests({
		cwd,
		rows: [{ testFile: 'src/runGates.flake.unit.test.ts', testName: 'runGates: re-runs a crashed worker', gate: 'test' }],
		gates: results,
		final: true,
		packagesDir: 'packages',
	});

	expect(error).toBe(undefined);
});

test('checkAcceptanceTests: refuses a row whose only match did not pass', async () => {
	const { cwd, results } = setupGates({
		gates: [
			{
				kind: 'test',
				assertions: notPassingStatuses.map((status) => ({ file: `src/${status}.unit.test.ts`, title: 'subject: states the behaviour', status })),
			},
		],
	});

	const error = await checkAcceptanceTests({
		cwd,
		rows: notPassingStatuses.map((status) => ({ testFile: `src/${status}.unit.test.ts`, testName: 'subject: states the behaviour', gate: 'test' })),
		gates: results,
		final: false,
		packagesDir: 'packages',
	});

	expect(error).toEqual(expect.stringContaining('acceptance-tests'));

	for (const status of notPassingStatuses) {
		expect(error).toContain(`src/${status}.unit.test.ts`);
	}
});

test('checkAcceptanceTests: proves a parameterised row by every substituted case passing and fails it on an empty or partly failing expansion', async () => {
	const { cwd, results } = setupGates({
		gates: [
			{
				kind: 'test',
				assertions: [
					{ file: 'src/formatCurrency.unit.test.ts', title: 'formatCurrency: formats 100 in en-US' },
					{ file: 'src/formatCurrency.unit.test.ts', title: 'formatCurrency: formats 100 in en-GB' },
					{ file: 'src/parseDate.unit.test.ts', title: 'parseDate: rejects rubbish' },
					{ file: 'src/clamp.unit.test.ts', title: 'clamp: clamps 5 to 10' },
					{ file: 'src/clamp.unit.test.ts', title: 'clamp: clamps 50 to 10', status: 'failed' },
				],
			},
		],
	});

	const error = await checkAcceptanceTests({
		cwd,
		rows: [
			{ testFile: 'src/formatCurrency.unit.test.ts', testName: 'formatCurrency: formats $amount in $locale', gate: 'test' },
			{ testFile: 'src/parseDate.unit.test.ts', testName: 'parseDate: parses %s', gate: 'test' },
			{ testFile: 'src/clamp.unit.test.ts', testName: 'clamp: clamps %d to %d', gate: 'test' },
		],
		gates: results,
		final: false,
		packagesDir: 'packages',
	});

	expect(error).toEqual(expect.stringContaining('acceptance-tests'));
	expect(error).toContain('src/parseDate.unit.test.ts');
	expect(error).toContain('src/clamp.unit.test.ts');
	expect(error).not.toContain('src/formatCurrency.unit.test.ts');
});

test("checkAcceptanceTests: proves a row naming the test gate from the coverage gate's results", async () => {
	const { cwd, results } = setupGates({
		gates: [{ kind: 'testCoverage', assertions: [{ file: 'src/subject.unit.test.ts', title: 'subject: states the behaviour' }] }],
	});

	const error = await checkAcceptanceTests({
		cwd,
		rows: [
			{ testFile: 'src/subject.unit.test.ts', testName: 'subject: states the behaviour', gate: 'test' },
			{ testFile: 'src/subject.unit.test.ts', testName: 'subject: states the behaviour', gate: 'test-coverage' },
		],
		gates: results,
		final: true,
		packagesDir: 'packages',
	});

	expect(error).toBe(undefined);
});

test('checkAcceptanceTests: skips a row whose gate did not run, and fails it at the final checkpoint', async () => {
	// Only the check gate ran, so nothing this checkpoint observed could carry the row's result.
	const { cwd, results } = setupGates({ gates: [{ kind: 'check' }] });
	const rows = [{ testFile: 'src/lonely.unit.test.ts', testName: 'lonely: states the behaviour', gate: 'test' }];
	const onProgress = jest.fn<(message: string) => void>();

	const skipped = await checkAcceptanceTests({ cwd, rows, gates: results, final: false, packagesDir: 'packages', onProgress });
	const failed = await checkAcceptanceTests({ cwd, rows, gates: results, final: true, packagesDir: 'packages' });

	expect(skipped).toBe(undefined);
	expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('src/lonely.unit.test.ts'));
	expect(failed).toEqual(expect.stringContaining('acceptance-tests'));
	expect(failed).toContain('src/lonely.unit.test.ts');
});

test('checkAcceptanceTests: ignores a row whose gate exited non-zero', async () => {
	// The gate is red and its results show the row's case failing. Counted, the
	// row would be an acceptance failure; the red gate owns that report instead.
	const { cwd, results } = setupGates({
		gates: [{ kind: 'test', exitCode: 1, assertions: [{ file: 'src/red.unit.test.ts', title: 'red: states the behaviour', status: 'failed' }] }],
	});
	const onProgress = jest.fn<(message: string) => void>();

	const error = await checkAcceptanceTests({
		cwd,
		rows: [{ testFile: 'src/red.unit.test.ts', testName: 'red: states the behaviour', gate: 'test' }],
		gates: results,
		final: false,
		packagesDir: 'packages',
		onProgress,
	});

	expect(error).toBe(undefined);
	expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('src/red.unit.test.ts'));
});

test('checkAcceptanceTests: matches results to a row by package group, so a package that skipped the gate leaves its rows unproven rather than missing', async () => {
	const { cwd, results } = setupGates({
		gates: [
			{
				kind: 'test',
				group: 'api',
				assertions: [
					{ file: 'packages/api/src/a.unit.test.ts', title: 'a: states the behaviour' },
					// The api suite never executed a web file. Read as evidence, this
					// would prove the web row the web package never ran.
					{ file: 'packages/web/src/b.unit.test.ts', title: 'b: states the behaviour' },
				],
			},
			{ kind: 'test', group: 'web', skipped: true },
		],
	});
	const rows = [
		{ testFile: 'packages/api/src/a.unit.test.ts', testName: 'a: states the behaviour', gate: 'test' },
		{ testFile: 'packages/web/src/b.unit.test.ts', testName: 'b: states the behaviour', gate: 'test' },
	];
	const onProgress = jest.fn<(message: string) => void>();

	const skipped = await checkAcceptanceTests({ cwd, rows, gates: results, final: false, packagesDir: 'packages', onProgress });
	const failed = await checkAcceptanceTests({ cwd, rows, gates: results, final: true, packagesDir: 'packages' });

	expect(skipped).toBe(undefined);
	expect(onProgress).toHaveBeenCalledTimes(1);
	expect(onProgress).toHaveBeenCalledWith(expect.stringContaining('packages/web/src/b.unit.test.ts'));
	expect(failed).toContain('packages/web/src/b.unit.test.ts');
	expect(failed).not.toContain('packages/api/src/a.unit.test.ts');
});
