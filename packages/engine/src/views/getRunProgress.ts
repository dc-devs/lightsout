import { type RunLock, type RunManifest, RunStatus, ShipStatus } from '#src/contracts/index.ts';
import { isRunLive, readLastProgressMessage } from '#src/runState/index.ts';
import { readShipResult } from '#src/ship/index.ts';
import type { RunProgress } from '#src/views/common/types/RunProgress.ts';
import type { RunProgressRow } from '#src/views/common/types/RunProgressRow.ts';
import { getRunTitle } from '#src/views/common/utils/getRunTitle.ts';

/** Statuses from which this run can still reach ship — a run that ended any other way never will. */
const shippableStatuses: RunStatus[] = [RunStatus.Running, RunStatus.Pending, RunStatus.PausedRateLimit, RunStatus.PausedBudget, RunStatus.Passed];

/** How a filed ship result reads as a table row outcome. */
const shipRowStatus: Record<ShipStatus, RunStatus> = {
	[ShipStatus.Shipped]: RunStatus.Passed,
	[ShipStatus.Blocked]: RunStatus.Failed,
};

/** The ship row's outcome: passed on a shipped branch, failed on a blocked one, and undefined when no result was ever filed. */
const readShipRow = async ({ cwd, manifest }: { cwd: string; manifest: RunManifest }): Promise<RunProgressRow> => {
	const result = manifest.branch === undefined ? undefined : await readShipResult({ cwd, branch: manifest.branch });

	return { id: 'ship', status: result && shipRowStatus[result.status], attempts: result === undefined ? 0 : 1, durationMs: undefined };
};

interface Params {
	cwd: string;
	manifest: RunManifest;
	/** The repo lock, or undefined when nothing holds it — what decides whether a running row ticks. */
	lock: RunLock | undefined;
}

/**
 * A run's progress block, built from what the run already persisted.
 *
 * A view, never a second source of truth: every number here is read from the
 * manifest, the progress log and the ship directory, exactly as `summarizeRun`
 * reads a finished run's totals.
 *
 * The one thing it adds is the clock. A long step writes nothing while it
 * works, so a frozen duration would tell a reader nothing about whether the
 * step is slow or wedged — the running step of a LIVE run therefore shows its
 * persisted total plus the time since the manifest's last write. A run with no
 * process behind it shows the persisted number unchanged, because a crashed run
 * that kept ticking would read as work.
 */
export const getRunProgress = async ({ cwd, manifest, lock }: Params): Promise<RunProgress> => {
	const live = isRunLive({ manifest, lock });
	const sinceWriteMs = live ? Math.max(0, Date.now() - Date.parse(manifest.updatedAt)) : 0;
	const rows: RunProgressRow[] = manifest.steps.map((step) => ({
		id: step.id,
		status: step.status,
		attempts: step.attempts,
		durationMs: step.status === RunStatus.Running ? (step.durationMs ?? 0) + sinceWriteMs : step.durationMs,
	}));
	const recorded = new Set(rows.map((row) => row.id));

	// Only a pipeline that declared its sequence gets pending rows. Refactor,
	// coverage and phases discover their work as they go, and a guessed row is
	// worse than none.
	for (const id of manifest.stepOrder ?? []) {
		if (!recorded.has(id)) {
			rows.push({ id, status: undefined, attempts: 0, durationMs: undefined });
		}
	}

	// A run that ended failed or escalated will never ship — exitAfterImplement
	// refuses a result that is not ok — so a pending ship row would promise a
	// reader work still to come. Omitted, the table's last row is the step that
	// stopped the run, which is what they wanted to see.
	const shipRow = manifest.willShip === true && shippableStatuses.includes(manifest.status) ? await readShipRow({ cwd, manifest }) : undefined;

	if (shipRow) {
		rows.push(shipRow);
	}

	return {
		runId: manifest.runId,
		shortId: manifest.runId.slice(0, 8),
		title: getRunTitle({ plan: manifest.plan }),
		status: manifest.status,
		live,
		rows,
		elapsedMs: Math.max(0, Date.parse(manifest.updatedAt) - Date.parse(manifest.createdAt)) + sinceWriteMs,
		changedFileCount: manifest.changedFiles.length,
		costUsd: manifest.usage?.costUsd,
		now: await readLastProgressMessage({ cwd, runId: manifest.runId }),
		awaitingShip: shipRow !== undefined && shipRow.status === undefined,
	};
};
