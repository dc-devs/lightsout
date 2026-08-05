import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { getRunDir } from '@/runState';

describe('getRunDir', () => {
	test('places a run inside the target repo under .lightsout/runs', () => {
		const dir = getRunDir({ cwd: '/repo', runId: 'run-a' });

		assert.equal(dir, '/repo/.lightsout/runs/run-a');
	});

	test('gives every run its own directory beneath the shared runs folder', () => {
		const first = getRunDir({ cwd: '/repo', runId: 'run-a' });
		const second = getRunDir({ cwd: '/repo', runId: 'run-b' });

		assert.deepEqual([first, second], ['/repo/.lightsout/runs/run-a', '/repo/.lightsout/runs/run-b']);
	});

	test('normalises a trailing slash on the repo path rather than doubling it', () => {
		const dir = getRunDir({ cwd: '/repo/', runId: 'run-a' });

		assert.equal(dir, '/repo/.lightsout/runs/run-a');
	});

	test('resolves relative to the given repo, never to the process cwd', () => {
		const dir = getRunDir({ cwd: 'consumer', runId: 'run-a' });

		assert.equal(dir, 'consumer/.lightsout/runs/run-a');
	});
});
