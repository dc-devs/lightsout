import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { testResultsDir } from '#src/gates/testResults/testResultsDir.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

test('testResultsDir: keys the directory by step, group and kind and sanitises each segment', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-test-results-dir-'));
	const runDir = runDirFor({ cwd, runId: 'run-7' });

	mkdirSync(runDir, { recursive: true });

	// two calls, one claim: the directory a gate execution writes to is keyed by
	// its step, its package group and its gate kind, and each of those three is
	// a value the engine does not control — a package directory name and a
	// config key — so every character that is not safe in a path segment
	// becomes a hyphen before it is joined
	const dirs = [
		await testResultsDir({ cwd, runId: 'run-7', step: 'verify-tests', group: 'root', kind: 'testCoverage' }),
		await testResultsDir({ cwd, runId: 'run-7', step: 'verify implement/2', group: '@scope/pkg', kind: 'test:e2e' }),
	];

	expect(dirs).toStrictEqual([
		join(runDir, 'test-results', 'verify-tests', 'root', 'testCoverage'),
		join(runDir, 'test-results', 'verify-implement-2', '-scope-pkg', 'test-e2e'),
	]);
});
