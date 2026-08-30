import { setTimeout as delay } from 'node:timers/promises';
import { printRunProgress } from '#src/cli/common/render/printRunProgress.ts';
import { resolveWatchTarget } from '#src/cli/common/utils/resolveWatchTarget.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { readRunLock, readRunManifest } from '#src/runState/index.ts';
import { getRunProgress, type RunProgress } from '#src/views/index.ts';

/** Wait, painting nothing, for the ship result to land — then paint the frame that has it. */
const settleShip = async ({ cwd, runId, pollMs, ceilingMs }: { cwd: string; runId: string; pollMs: number; ceilingMs: number }) => {
	const deadline = Date.now() + ceilingMs;
	let awaiting = true;

	while (awaiting && Date.now() < deadline) {
		await delay(pollMs);

		const manifest = await readRunManifest({ cwd, runId });
		const lock = await readRunLock({ cwd });

		awaiting = (await getRunProgress({ cwd, manifest, lock })).awaitingShip;
	}

	await printRunProgress({ cwd, runId });
};

interface Params {
	cwd: string;
	/** The run to follow. Omitted in follow mode, where the target is re-resolved every frame. */
	runId?: string;
	/** Milliseconds between repaints. Defaults to the two-minute cadence; a test passes a short one. */
	intervalMs?: number;
	/** How long follow mode waits for the next run to appear at a phase boundary. */
	handoffMs?: number;
	/** Milliseconds between ship-result checks once the run itself has finished. */
	shipPollMs?: number;
	/** How long to wait for a ship result before painting the last frame anyway. */
	shipCeilingMs?: number;
}

/**
 * Repaint the run in progress until there is nothing left to say.
 *
 * **Which run.** With a `runId` it follows exactly that one. Without one it is
 * in FOLLOW mode: every frame re-asks `resolveWatchTarget` which run is going,
 * and paints that. Follow mode is what makes a phased plan watchable. Such a
 * plan has two live manifests — the coordinator, written once per phase, and
 * the current phase's child run, written on every step — and re-asking each
 * frame lands on the right one without anybody choosing: during a phase the
 * child is the more recently updated, so the block shows that phase's steps
 * ticking; in the gap between phases only the coordinator is going, so the
 * block shows the sequence; and when the coordinator finishes, nothing is
 * going and the watch ends. Fixing on one run instead would either end the
 * watch at the first phase boundary or show a block that barely moves.
 *
 * **When it stops.** A frame whose status is neither `running` nor `pending`
 * is the last one, so the final frame a reader keeps is the end state. Two
 * minutes is the cadence because the reader is a chat transcript as often as a
 * terminal, and a transcript repainted every few seconds is unreadable.
 *
 * A crashed run is the other way out. A manifest can say `running` with no
 * process behind it — a killed terminal, an uncaught error — and a watch that
 * only read the status would repaint that forever. So two CONSECUTIVE frames
 * with no live process end the watch too. Two, not one, because a phased
 * coordinator holds no lock of its own between phases, and a healthy sequence
 * must not be called a crash.
 *
 * **The ship settle.** Shipping happens AFTER the pipeline returns: the
 * manifest already says `passed` while the branch is still being pushed and CI
 * is still red or green. A watch that stopped at the terminal status would
 * therefore leave `ship` reading pending in the very frame a reader keeps. So
 * when the last frame is `awaitingShip`, the watch waits — quietly, at a short
 * poll, and no longer than the ceiling — for the ship result to land, then
 * paints ONE more frame. Quietly and once, because a CI wait is open-ended and
 * fifteen identical blocks in a transcript are worse than none.
 */
export const watchRunProgress = async ({
	cwd,
	runId,
	intervalMs = 120_000,
	handoffMs = 10_000,
	shipPollMs = 10_000,
	shipCeilingMs = 1_800_000,
}: Params): Promise<void> => {
	// Two consecutive frames with no live process behind the run end it. One is
	// not enough: a phased coordinator holds no lock between phases.
	const deadFrameCeiling = 2;
	let deadFrames = 0;
	let watching = true;
	let last: RunProgress | undefined;

	while (watching) {
		// Follow mode passes a SHORT grace rather than resolveWatchTarget's own:
		// the long wait belongs to the one call statusCommand makes before the
		// watch starts, where it covers a just-started run. Inside the loop the
		// same wait would only delay the exit once the sequence is over.
		const target = runId ?? (await resolveWatchTarget({ cwd, graceMs: handoffMs }));

		if (target === undefined) {
			break;
		}

		last = await printRunProgress({ cwd, runId: target });
		deadFrames = last.live ? 0 : deadFrames + 1;
		watching = (last.status === RunStatus.Running || last.status === RunStatus.Pending) && deadFrames < deadFrameCeiling;

		if (watching) {
			await delay(intervalMs);
		}
	}

	if (last?.awaitingShip === true && last.status === RunStatus.Passed) {
		await settleShip({ cwd, runId: last.runId, pollMs: shipPollMs, ceilingMs: shipCeilingMs });
	}
};
