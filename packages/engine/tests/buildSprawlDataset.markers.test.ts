import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from '@jest/globals';
import { runSprawlDriver } from '#tests/helpers/sprawl/runSprawlDriver.ts';
import { seedSprawlRepo } from '#tests/helpers/sprawl/seedSprawlRepo.ts';

// Where the animation is allowed to show a move: the commits a passed refactor
// run finished at. The run history lives in .lightsout/, which is gitignored,
// so this is the one input a clean checkout does not have — and a rebuild
// without it has to say so rather than quietly ship a marker-less dataset.

const lines = ({ count }: { count: number }) => 'const x = 1;\n'.repeat(count);
const repos: string[] = [];

const manifest = ({ pipeline, status, updatedAt }: { pipeline: string; status: string; updatedAt: string }) => JSON.stringify({ pipeline, status, updatedAt });

const setupMarkedHistory = ({ runs }: { runs?: Record<string, string> } = {}) => {
	const cwd = seedSprawlRepo({
		commits: [
			{ message: 'first', at: '2026-02-01T00:00:00Z', write: { 'packages/app/src/a.ts': lines({ count: 3 }) } },
			{ message: 'second', at: '2026-02-02T00:00:00Z', write: { 'packages/app/src/a.ts': lines({ count: 4 }) } },
			{ message: 'third', at: '2026-02-03T00:00:00Z', write: { 'packages/app/src/a.ts': lines({ count: 5 }) } },
		],
		runs,
	});

	repos.push(cwd);

	return { cwd };
};

const buildDataset = ({ cwd }: { cwd: string }) =>
	runSprawlDriver<{ logs: string[]; dataset: { frames: { isRefactorMarker: boolean }[] } }>({
		cwd,
		body: [
			"import { buildSprawlDataset } from './scripts/buildSprawlDataset.mjs';",
			'',
			'const logs = [];',
			'const dataset = buildSprawlDataset({ log: (line) => logs.push(line) });',
			'',
			'report({ logs, dataset });',
		].join('\n'),
	});

afterAll(() => {
	for (const cwd of repos) {
		rmSync(join(cwd, '..'), { recursive: true, force: true });
	}
});

describe('buildSprawlDataset markers', () => {
	test('marks the first frame at or after a passed refactor run finished', () => {
		const { cwd } = setupMarkedHistory({ runs: { 'run-1': manifest({ pipeline: 'refactor', status: 'passed', updatedAt: '2026-02-01T09:00:00Z' }) } });

		const { dataset } = buildDataset({ cwd });

		expect(dataset.frames.map((frame) => frame.isRefactorMarker)).toStrictEqual([false, true, false]);
	});

	test('marks the last frame for a run that finished after every commit, so the newest refactor is never the one that goes missing', () => {
		const { cwd } = setupMarkedHistory({ runs: { 'run-1': manifest({ pipeline: 'refactor', status: 'passed', updatedAt: '2027-01-01T00:00:00Z' }) } });

		const { dataset } = buildDataset({ cwd });

		expect(dataset.frames.map((frame) => frame.isRefactorMarker)).toStrictEqual([false, false, true]);
	});

	test('marks nothing for a run that was not a refactor, or was a refactor that did not pass', () => {
		const { cwd } = setupMarkedHistory({
			runs: {
				'run-1': manifest({ pipeline: 'implement', status: 'passed', updatedAt: '2026-02-02T00:00:00Z' }),
				'run-2': manifest({ pipeline: 'refactor', status: 'failed', updatedAt: '2026-02-02T00:00:00Z' }),
			},
		});

		const { dataset } = buildDataset({ cwd });

		expect(dataset.frames.map((frame) => frame.isRefactorMarker)).toStrictEqual([false, false, false]);
	});

	test('skips a manifest it cannot read, says which one, and still marks the runs it could read', () => {
		const { cwd } = setupMarkedHistory({
			runs: { 'run-broken': 'not json at all', 'run-good': manifest({ pipeline: 'refactor', status: 'passed', updatedAt: '2026-02-03T00:00:00Z' }) },
		});

		const { logs, dataset } = buildDataset({ cwd });

		expect({ marks: dataset.frames.map((frame) => frame.isRefactorMarker), said: logs.some((line) => line.includes('run-broken')) }).toStrictEqual({
			marks: [false, false, true],
			said: true,
		});
	});

	test('marks nothing and says so on a checkout with no run history at all', () => {
		const { cwd } = setupMarkedHistory();

		const { logs, dataset } = buildDataset({ cwd });

		expect({ marks: dataset.frames.map((frame) => frame.isRefactorMarker), said: logs.some((line) => /no \.lightsout\/runs\//.test(line)) }).toStrictEqual({
			marks: [false, false, false],
			said: true,
		});
	});
});
