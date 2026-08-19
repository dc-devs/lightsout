import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { getRunManifestPath } from '@/runState/common/paths/getRunManifestPath';

test('getRunManifestPath: one manifest per run, inside that run’s own directory', () => {
	expect(getRunManifestPath({ cwd: '/repo', runId: 'run-7' })).toBe(join('/repo', '.lightsout', 'runs', 'run-7', 'manifest.json'));
});
