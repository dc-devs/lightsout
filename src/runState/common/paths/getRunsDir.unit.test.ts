import { describe, expect, test } from '@jest/globals';
import { getRunsDir } from '@/runState';

describe('getRunsDir', () => {
	test('gathers every run under .lightsout/runs inside the target repo', () => {
		const dir = getRunsDir({ cwd: '/repo' });

		expect(dir).toBe('/repo/.lightsout/runs');
	});

	test('normalises a trailing slash on the repo path rather than doubling it', () => {
		const dir = getRunsDir({ cwd: '/repo/' });

		expect(dir).toBe('/repo/.lightsout/runs');
	});

	test('resolves relative to the given repo, never to the process cwd', () => {
		const dir = getRunsDir({ cwd: 'consumer' });

		expect(dir).toBe('consumer/.lightsout/runs');
	});
});
