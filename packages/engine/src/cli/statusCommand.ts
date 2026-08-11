import { readdir } from 'node:fs/promises';
import type { CommandContext } from '@/cli/common/types/CommandContext';
import { PhaseReport, type RunLock, type RunManifest, RunStatus } from '@/contracts';
import { getRunsDir, isPidAlive, readRunLock, readRunManifest } from '@/runState';

/**
 * Whether a live process stands behind this run.
 *
 * A phased run holds no lock of its own: while one of its phases runs, the repo
 * lock is held under the CHILD run's id, so the coordinator's own id is only
 * ever the holder between phases. Accepting either id is what keeps a healthy
 * sequence from being branded a crash.
 */
const hasLiveProcess = ({ manifest, lock }: { manifest: RunManifest; lock: RunLock | undefined }) => {
	if (!lock || !isPidAlive({ pid: lock.pid })) {
		return false;
	}

	if (lock.runId === manifest.runId) {
		return true;
	}

	const running = manifest.steps.find((step) => step.status === RunStatus.Running);

	if (manifest.pipeline !== 'phases' || running === undefined) {
		return false;
	}

	const child = PhaseReport.safeParse(running.report);

	return child.success && child.data.runId === lock.runId;
};

export const statusCommand = async ({ cwd }: CommandContext): Promise<void> => {
	const runIds = await readdir(getRunsDir({ cwd })).catch(() => []);

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
			const zombie = manifest.status === RunStatus.Running && !hasLiveProcess({ manifest, lock });
			const status = zombie ? `${manifest.status} (no live process — crashed? resume with --run ${manifest.runId})` : manifest.status;
			const phases =
				manifest.pipeline === 'phases' ? `  phases: ${manifest.steps.filter((step) => step.status === RunStatus.Passed).length}/${manifest.steps.length}` : '';

			console.log(`${manifest.runId}  ${status}  plan: ${manifest.plan}${phases}  updated: ${manifest.updatedAt}`);
		}
	}

	process.exit(0);
};
