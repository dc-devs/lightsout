import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { getRunStandardsBaselinePath } from '#src/runState/standardsBaseline/internal/getRunStandardsBaselinePath.ts';
import { runDirFor } from '#tests/helpers/runDirFor.ts';

describe('getRunStandardsBaselinePath', () => {
	test('puts the baseline beside the manifest in the run’s own folder', async () => {
		const cwd = mkdtempSync(join(tmpdir(), 'lightsout-baseline-path-'));
		const runDir = runDirFor({ cwd, runId: 'run-7' });

		mkdirSync(runDir, { recursive: true });

		const path = await getRunStandardsBaselinePath({ cwd, runId: 'run-7' });

		expect(path).toBe(join(runDir, 'standards-baseline.json'));
	});
});
