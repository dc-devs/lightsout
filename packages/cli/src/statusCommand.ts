import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RunStatus } from '@lightsout/contracts';
import { isPidAlive, readRunLock, readRunManifest } from '@lightsout/engine';
import type { CommandContext } from './common/types/CommandContext';

export const statusCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const runsDir = join(cwd, '.lightsout', 'runs');
	const runIds = await readdir(runsDir).catch(() => []);

	if (runIds.length === 0) {
		console.log('no runs found');
		process.exit(0);
	}

	const lock = await readRunLock({ cwd });

	for (const runId of runIds) {
		const manifest = await readRunManifest({ cwd, runId }).catch(() => undefined);

		if (manifest) {
			// A `running` manifest with no live process behind it is a crash
			// leftover (killed terminal, uncaught error) — resumable, not lost.
			const zombie =
				manifest.status === RunStatus.Running &&
				!(lock && lock.runId === manifest.runId && isPidAlive({ pid: lock.pid }));
			const status = zombie ? `${manifest.status} (no live process — crashed? resume with --run ${manifest.runId})` : manifest.status;

			console.log(`${manifest.runId}  ${status}  plan: ${manifest.plan}  updated: ${manifest.updatedAt}`);
		}
	}

	process.exit(0);
};
