import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { testResultsDir } from '#src/gates/testResults/testResultsDir.ts';

test('testResultsDir: keys the directory by step, group and kind and sanitises each segment', () => {
	// two calls, one claim: the directory a gate execution writes to is keyed by
	// its step, its package group and its gate kind, and each of those three is
	// a value the engine does not control — a package directory name and a
	// config key — so every character that is not safe in a path segment
	// becomes a hyphen before it is joined
	const dirs = [
		testResultsDir({ cwd: '/repo', runId: 'run-7', step: 'verify-tests', group: 'root', kind: 'testCoverage' }),
		testResultsDir({ cwd: '/repo', runId: 'run-7', step: 'verify implement/2', group: '@scope/pkg', kind: 'test:e2e' }),
	];

	expect(dirs).toStrictEqual([
		join('/repo', '.lightsout', 'runs', 'run-7', 'test-results', 'verify-tests', 'root', 'testCoverage'),
		join('/repo', '.lightsout', 'runs', 'run-7', 'test-results', 'verify-implement-2', '-scope-pkg', 'test-e2e'),
	]);
});
