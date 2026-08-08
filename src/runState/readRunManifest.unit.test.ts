import { expect, describe, test } from '@jest/globals';
import { createRun, readRunManifest, RunNotFoundError } from '@/runState';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

describe('readRunManifest', () => {
	test('reads a run by the shortened id its own report printed', async () => {
		const cwd = setupConsumerRepo({ git: false });
		const created = await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		const manifest = await readRunManifest({ cwd, runId: created.runId.slice(0, 8) });

		expect(manifest.runId).toBe(created.runId);
	});

	test('reports an unknown run by name rather than by the file it failed to open', async () => {
		const cwd = setupConsumerRepo({ git: false });
		await createRun({ cwd, plan: 'plan.md', driver: 'stub' });

		// the old failure was a raw ENOENT naming .lightsout/runs/<id>/manifest.json
		await expect(readRunManifest({ cwd, runId: 'nosuchrun' })).rejects.toThrow(RunNotFoundError);
	});
});
