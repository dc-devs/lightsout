import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { readTestResults } from '#src/gates/index.ts';

/** One results file as the reporter writes it: absolute test file path, one entry per assertion. */
const resultsFile = ({ cwd, testFile, assertions }: { cwd: string; testFile: string; assertions: Record<string, unknown>[] }) =>
	JSON.stringify({ testResults: [{ testFilePath: join(cwd, testFile), assertionResults: assertions }] });

/** A repo root plus one gate execution's results directory under it, created and empty. */
const setupResultsDir = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-results-'));
	const dir = join(cwd, '.lightsout', 'runs', 'run-1', 'test-results', 'verify-tests', 'root', 'test');

	mkdirSync(dir, { recursive: true });

	return { cwd, dir };
};

test('readTestResults: merges every results file in the directory and relativises each test file path', async () => {
	const { cwd, dir } = setupResultsDir();

	writeFileSync(
		join(dir, '4101-1750000000000.json'),
		resultsFile({
			cwd,
			testFile: 'packages/engine/src/alpha.unit.test.ts',
			assertions: [{ title: 'alpha passes', ancestorTitles: ['alpha'], fullName: 'alpha alpha passes', status: 'passed', durationMs: 12 }],
		}),
	);
	writeFileSync(
		join(dir, '4102-1750000000001.json'),
		resultsFile({
			cwd,
			testFile: 'packages/engine/src/beta.unit.test.ts',
			assertions: [{ title: 'beta was skipped', ancestorTitles: [], fullName: 'beta was skipped', status: 'skipped' }],
		}),
	);
	// Not a results file: only `.json` entries are read.
	writeFileSync(join(dir, 'notes.txt'), 'ignored');

	const results = await readTestResults({ cwd, dir });

	// One jest process writes one file, so the merge order across files is the
	// directory's — the set is the contract, not its order.
	expect(results).toHaveLength(2);
	expect(results).toEqual(
		expect.arrayContaining([
			{
				testFilePath: 'packages/engine/src/alpha.unit.test.ts',
				assertionResults: [{ title: 'alpha passes', ancestorTitles: ['alpha'], fullName: 'alpha alpha passes', status: 'passed', durationMs: 12 }],
			},
			{
				testFilePath: 'packages/engine/src/beta.unit.test.ts',
				assertionResults: [{ title: 'beta was skipped', ancestorTitles: [], fullName: 'beta was skipped', status: 'skipped' }],
			},
		]),
	);
});

test('readTestResults: answers an empty list for a missing or unreadable directory', async () => {
	const { cwd, dir } = setupResultsDir();

	// Never created: the gate ran no jest process at all.
	expect(await readTestResults({ cwd, dir: join(cwd, 'test-results', 'never-ran') })).toStrictEqual([]);

	// A file where a directory was expected — its entries cannot be listed.
	writeFileSync(join(cwd, 'not-a-directory'), 'x');
	expect(await readTestResults({ cwd, dir: join(cwd, 'not-a-directory') })).toStrictEqual([]);

	// Created but empty: the reporter never loaded, so it wrote nothing.
	expect(await readTestResults({ cwd, dir })).toStrictEqual([]);

	writeFileSync(join(dir, 'truncated.json'), '{"testResults": [{"testFile');
	writeFileSync(join(dir, 'wrong-shape.json'), JSON.stringify({ testResults: [{ assertionResults: [] }] }));

	// Malformed and off-contract files are dropped rather than thrown on.
	expect(await readTestResults({ cwd, dir })).toStrictEqual([]);
});
