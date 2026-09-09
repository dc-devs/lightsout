import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getRunStandardsBaselinePath } from '#src/runState/standardsBaseline/getRunStandardsBaselinePath.ts';

describe('getRunStandardsBaselinePath', () => {
	test('puts the baseline beside the manifest in the run’s own folder', () => {
		const path = getRunStandardsBaselinePath({ cwd: '/repo', runId: 'run-7' });

		expect(path).toBe(join('/repo', '.lightsout', 'runs', 'run-7', 'standards-baseline.json'));
	});
});
