import { PhaseReport } from '#src/contracts/run/PhaseReport.ts';
import { PipelineKind } from '#src/contracts/run/PipelineKind.ts';
import type { RunLock } from '#src/contracts/run/RunLock.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { isPidAlive } from '#src/runState/isPidAlive.ts';

interface Params {
	manifest: RunManifest;
	/** The repo lock, or undefined when nothing holds it. */
	lock: RunLock | undefined;
}

/**
 * Whether a live process stands behind this run.
 *
 * A phased run holds no lock of its own: while one of its phases runs, the repo
 * lock is held under the CHILD run's id, so the coordinator's own id is only
 * ever the holder between phases. Accepting either id is what keeps a healthy
 * sequence from being branded a crash.
 */
export const isRunLive = ({ manifest, lock }: Params): boolean => {
	if (!lock || !isPidAlive({ pid: lock.pid })) {
		return false;
	}

	if (lock.runId === manifest.runId) {
		return true;
	}

	const running = manifest.steps.find((step) => step.status === RunStatus.Running);

	if (manifest.pipeline !== PipelineKind.Phases || running === undefined) {
		return false;
	}

	const child = PhaseReport.safeParse(running.report);

	return child.success && child.data.runId === lock.runId;
};
