import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@jest/globals';
import { getRunManifestPath } from '#src/runState/common/paths/getRunManifestPath.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

test('getRunManifestPath: one manifest per run, inside that run’s own directory', async () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-manifest-path-'));
	const runDir = runDirFor({ cwd, runId: 'run-7' });

	mkdirSync(runDir, { recursive: true });

	expect(await getRunManifestPath({ cwd, runId: 'run-7' })).toBe(join(runDir, 'manifest.json'));
});
