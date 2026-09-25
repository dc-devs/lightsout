import { renderProgressBlock } from '#src/cli/internal/common/progressBlock/renderProgressBlock.ts';
import { formatClockDuration } from '#src/cli/internal/common/utils/formatClockDuration.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { ShippingStepId } from '#src/contracts/ship/ShippingStepId.ts';
import { isPidAlive } from '#src/runState/isPidAlive.ts';
import type { ShippingProgressReading } from '#src/ship/progress/common/types/ShippingProgressReading.ts';
import { readShippingProgress } from '#src/ship/progress/readShippingProgress.ts';

/** The record as read: undefined when the branch has none. */
type RecordedProgress = ShippingProgressReading['progress'];

/** Local 24-hour HH:MM — the clock a reader compares against the one on their own screen. */
const localClock = ({ iso }: { iso: string }) => {
	const at = new Date(iso);

	return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/**
 * The six fixed rows, whatever the record holds. Only a live ship's running
 * step keeps its clock ticking; a running step in a record whose process is
 * gone is drawn failed with no clock, because it can no longer finish and
 * drawing it running would make a crashed ship look busy.
 */
const shippingRows = ({ progress, live, nowMs }: { progress: RecordedProgress; live: boolean; nowMs: number }) =>
	Object.values(ShippingStepId).map((id) => {
		const step = progress?.steps.find((candidate) => candidate.id === id);

		if (step === undefined || step.status === RunStatus.Pending) {
			return { id, status: undefined, attempts: 0, durationMs: undefined };
		}

		let status = step.status;
		let durationMs = step.durationMs;

		if (step.status === RunStatus.Running) {
			status = live ? RunStatus.Running : RunStatus.Failed;
			durationMs = live && step.startedAt !== undefined ? nowMs - Date.parse(step.startedAt) : undefined;
		}

		return { id, status, attempts: 1, durationMs };
	});

/** Wall time from the ship's start: to its end once it ended, to now while it is live, and to its last update when its process is gone. */
const shippingElapsedMs = ({ progress, live, nowMs }: { progress: RecordedProgress; live: boolean; nowMs: number }) => {
	if (progress === undefined) {
		return 0;
	}

	const endMs = progress.endedAt !== undefined ? Date.parse(progress.endedAt) : live ? nowMs : Date.parse(progress.updatedAt);

	return Math.max(0, endMs - Date.parse(progress.startedAt));
};

/** The line that keeps a stopped ship's failed row from reading as a real failure — a red `checks` row would otherwise read as red CI. */
const noLiveProcessLine = ({ progress }: { progress: NonNullable<RecordedProgress> }) => {
	const running = progress.steps.find((step) => step.status === RunStatus.Running);
	const subject = running === undefined ? 'this ship' : running.id;

	return ` no live process is recording ${subject} · last update ${localClock({ iso: progress.updatedAt })}`;
};

interface Params {
	/** The checkout that ships the branch. */
	cwd: string;
	/** The branch as git names it. */
	branch: string;
}

/**
 * A branch's shipping block as lines, in the run block's layout. It prints
 * nothing, and never throws for a missing or unreadable record: a missing one
 * draws every step not reached, an unreadable one answers a single line naming
 * the file, and a branch no work order claims answers a single line saying it
 * keeps no local record at all.
 *
 * Liveness is judged by the end stamp first and the recorded pid second, so a
 * finished ship reads as finished whatever became of its process, and the clock
 * is read once, so every time the block shows agrees with every other.
 */
export const loadShippingProgressBlock = async ({ cwd, branch }: Params): Promise<string[]> => {
	const nowMs = Date.now();
	const { path, exists, progress } = await readShippingProgress({ cwd, branch });

	if (path === undefined) {
		return [`${branch} keeps no local shipping record — no work order's record stores that branch`];
	}

	if (exists && progress === undefined) {
		return [`the shipping record ${path} could not be read`];
	}

	const unended = progress !== undefined && progress.endedAt === undefined;
	const live = unended && isPidAlive({ pid: progress.pid });
	const lastProgress = progress?.lastProgress?.replace(/\s+/g, ' ').trim();

	return renderProgressBlock({
		title: branch,
		tag: progress === undefined ? 'no attempt yet' : `attempt ${progress.attempt} of ${progress.maxAttempts}`,
		rows: shippingRows({ progress, live, nowMs }),
		diagnostics: unended && !live ? [noLiveProcessLine({ progress })] : [],
		totals: `elapsed ${formatClockDuration({ ms: shippingElapsedMs({ progress, live, nowMs }) })}`,
		now: progress === undefined ? 'no step has run yet' : lastProgress === '' ? undefined : lastProgress,
	});
};
