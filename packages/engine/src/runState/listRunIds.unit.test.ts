import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { listRunIds } from '@/runState';

const setupRepo = ({ runs = [], files = [] }: { runs?: string[]; files?: string[] } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-ids-'));
	const runsDir = join(cwd, '.lightsout', 'runs');

	mkdirSync(runsDir, { recursive: true });

	for (const runId of runs) {
		mkdirSync(join(runsDir, runId), { recursive: true });
	}

	for (const file of files) {
		writeFileSync(join(runsDir, file), 'not a run\n');
	}

	return cwd;
};

describe('listRunIds', () => {
	test('lists every run directory, sorted, so a report over them reads the same twice', async () => {
		const cwd = setupRepo({ runs: ['c3', 'a1', 'b2'] });

		expect(await listRunIds({ cwd })).toStrictEqual(['a1', 'b2', 'c3']);
	});

	test('a repo that has never run anything has no runs, not an error', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-run-ids-empty-'));

		expect(await listRunIds({ cwd })).toStrictEqual([]);
	});

	test('a runs directory that holds nothing yet lists no runs', async () => {
		const cwd = setupRepo();

		expect(await listRunIds({ cwd })).toStrictEqual([]);
	});

	test('a stray file beside the run directories is not a run', async () => {
		const cwd = setupRepo({ runs: ['a1'], files: ['README.md'] });

		expect(await listRunIds({ cwd })).toStrictEqual(['a1']);
	});
});
