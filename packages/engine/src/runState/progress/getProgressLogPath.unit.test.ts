import { describe, expect, test } from '@jest/globals';
import { getProgressLogPath } from '#src/runState/index.ts';

describe('getProgressLogPath', () => {
	test('places the narration beside the run it belongs to', () => {
		expect(getProgressLogPath({ cwd: '/repo', runId: 'run-a' })).toBe('/repo/.lightsout/runs/run-a/progress.jsonl');
	});

	test('gives every run its own log, so one run never reads another run’s lines', () => {
		const first = getProgressLogPath({ cwd: '/repo', runId: 'run-a' });
		const second = getProgressLogPath({ cwd: '/repo', runId: 'run-b' });

		expect([first, second]).toStrictEqual(['/repo/.lightsout/runs/run-a/progress.jsonl', '/repo/.lightsout/runs/run-b/progress.jsonl']);
	});

	test('resolves relative to the given repo, never to the process cwd', () => {
		expect(getProgressLogPath({ cwd: 'consumer', runId: 'run-a' })).toBe('consumer/.lightsout/runs/run-a/progress.jsonl');
	});
});
