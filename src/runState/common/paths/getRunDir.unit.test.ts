import { expect, describe, test } from '@jest/globals';
import { getRunDir } from '@/runState';

describe('getRunDir', () => {
	test('places a run inside the target repo under .lightsout/runs', () => {
		const dir = getRunDir({ cwd: '/repo', runId: 'run-a' });

		expect(dir).toBe('/repo/.lightsout/runs/run-a');
	});

	test('gives every run its own directory beneath the shared runs folder', () => {
		const first = getRunDir({ cwd: '/repo', runId: 'run-a' });
		const second = getRunDir({ cwd: '/repo', runId: 'run-b' });

		expect([first, second]).toStrictEqual(['/repo/.lightsout/runs/run-a', '/repo/.lightsout/runs/run-b']);
	});

	test('normalises a trailing slash on the repo path rather than doubling it', () => {
		const dir = getRunDir({ cwd: '/repo/', runId: 'run-a' });

		expect(dir).toBe('/repo/.lightsout/runs/run-a');
	});

	test('resolves relative to the given repo, never to the process cwd', () => {
		const dir = getRunDir({ cwd: 'consumer', runId: 'run-a' });

		expect(dir).toBe('consumer/.lightsout/runs/run-a');
	});
});
