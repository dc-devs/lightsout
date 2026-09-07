import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { GateResult } from '#src/contracts/index.ts';
import { checkAcceptanceTests } from '#src/gates/index.ts';

/** One assertion as the runner reported it, under the repo-relative test file it belongs to. */
interface Assertion {
	file: string;
	/** The describe blocks around the case; they make up its reported full name. */
	ancestorTitles: string[];
	title: string;
	/** Defaults to 'passed'. */
	status?: string;
}

const resultsDir = join('.lightsout', 'runs', 'run-1', 'test-results', 'verify-tests', 'root', 'test');

/**
 * A repo whose one green test gate left the given assertions behind, written
 * exactly as the reporter writes them: absolute test file paths, and a full name
 * built from the describe blocks around each case.
 */
const setupResults = ({ assertions }: { assertions: Assertion[] }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-acceptance-coverage-'));
	const files = [...new Set(assertions.map(({ file }) => file))];

	mkdirSync(join(cwd, resultsDir), { recursive: true });
	writeFileSync(
		join(cwd, resultsDir, 'jest-1.json'),
		JSON.stringify({
			testResults: files.map((file) => ({
				testFilePath: join(cwd, file),
				assertionResults: assertions
					.filter((assertion) => assertion.file === file)
					.map(({ title, ancestorTitles, status = 'passed' }) => ({
						title,
						ancestorTitles,
						fullName: [...ancestorTitles, title].join(' '),
						status,
						durationMs: 2,
					})),
			})),
		}),
	);

	const gates: GateResult[] = [{ kind: 'test', group: 'root', command: 'run test', exitCode: 0, testResultsDir: resultsDir }];

	return { cwd, gates };
};

/**
 * A repo whose one green test gate recorded no results directory at all — the
 * shape an execution takes when the engine had no run folder to give it.
 */
const setupDirectorylessGate = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-acceptance-coverage-'));
	const gates: GateResult[] = [{ kind: 'test', group: 'root', command: 'run test', exitCode: 0 }];

	return { cwd, gates };
};

describe('checkAcceptanceTests', () => {
	test('checkAcceptanceTests: proves a row named by the full name its describe blocks give the case', async () => {
		const { cwd, gates } = setupResults({
			assertions: [{ file: 'src/widget.unit.test.ts', ancestorTitles: ['widget', 'when empty'], title: 'renders nothing' }],
		});

		const error = await checkAcceptanceTests({
			cwd,
			rows: [{ testFile: 'src/widget.unit.test.ts', testName: 'widget when empty renders nothing', gate: 'test' }],
			gates,
			final: true,
			packagesDir: 'packages',
		});

		// A ledger row may name the case the way the runner reports it, describe
		// blocks and all — the title alone would never match that name.
		expect(error).toBe(undefined);
	});

	test('checkAcceptanceTests: answers undefined for a checkpoint carrying no acceptance rows', async () => {
		// The gate reported one failing case. With no row to prove, none of that is
		// this check's business — clean-slate asks exactly here, before a single
		// ledger test has been written.
		const { cwd, gates } = setupResults({ assertions: [{ file: 'src/widget.unit.test.ts', ancestorTitles: [], title: 'widget: renders', status: 'failed' }] });

		const error = await checkAcceptanceTests({ cwd, rows: [], gates, final: true, packagesDir: 'packages' });

		expect(error).toBe(undefined);
	});

	test('checkAcceptanceTests: leaves a row unproven when the only gate that could carry it recorded no results directory', async () => {
		const { cwd, gates } = setupDirectorylessGate();
		const rows = [{ testFile: 'src/widget.unit.test.ts', testName: 'widget: renders', gate: 'test' }];
		const progress: string[] = [];

		const skipped = await checkAcceptanceTests({ cwd, rows, gates, final: false, packagesDir: 'packages', onProgress: (message) => progress.push(message) });
		const failed = await checkAcceptanceTests({ cwd, rows, gates, final: true, packagesDir: 'packages' });

		// A green gate with no evidence slot of its own carries no result, so the
		// row takes the same path as one whose gate never ran: narrated here, red
		// at the checkpoint that has to prove it against the finished tree.
		expect(skipped).toBe(undefined);
		expect(progress).toEqual([expect.stringContaining('src/widget.unit.test.ts')]);
		expect(failed).toEqual(expect.stringContaining('acceptance-tests'));
		expect(failed).toContain('widget: renders');
	});
});
