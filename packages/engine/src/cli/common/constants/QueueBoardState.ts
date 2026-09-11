/**
 * What the queue's board says about the queue run behind it, which decides its
 * heading and whether any ticket is shown as active.
 *
 * `printQueueStatus` reads it off the run's list row:
 * - `Live` — the manifest is running or pending, and a live process stands behind it.
 * - `Stopped` — the manifest is running or pending, and no live process stands behind it.
 * - `Finished` — any other status.
 *
 * `queueCommand` always draws its final board as `Finished`. `RunStatus` is not
 * reused: live and stopped share a status and differ only by liveness.
 */
export const QueueBoardState = {
	Live: 'live',
	Stopped: 'stopped',
	Finished: 'finished',
} as const;

export type QueueBoardState = (typeof QueueBoardState)[keyof typeof QueueBoardState];
