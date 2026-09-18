import type { ActivityLevel } from '#src/activity/index.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { type HarnessProcessUsage, ProcessEndReason } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation, DriverResult } from '#src/drivers/index.ts';

interface Params {
	driver: Driver;
	invocation: DriverInvocation;
	/** The level this spawn belongs to. Absent wherever no run is being recorded. */
	activity?: ActivityLevel;
	/** Which spawn of the ladder this is, counting from one and never restarting — the same number the rejected-payload evidence files carry. */
	spawn: number;
	/** Whether this spawn is the cheap re-emit rather than a fresh role attempt. */
	reemit: boolean;
}

/**
 * One rung of the ladder: spawn the harness, watch what it reports as it
 * streams, and write one process mark whatever ends it.
 *
 * It says what the process produced without deciding what happens next, so the
 * loop that decides keeps room for the reasoning behind each of its exits. The
 * mark is evidence rather than a gate — a record that cannot be written must
 * never turn a working agent call into a failed one — and what it claims is
 * only what this function can prove at the moment the spawn settles: a
 * rejection is `timed-out` when the elapsed time reached the ceiling this call
 * handed the driver and `failed` otherwise, never by matching the text of the
 * rejection.
 *
 * Usage cannot wait for the spawn to settle, because a process killed at its
 * ceiling returns no result at all. The latest payload the stream reported is
 * kept as it arrives and written when nothing better came back; a spawn that
 * reported neither writes no usage, never a zero that would be
 * indistinguishable from a real one.
 */
export const recordHarnessProcess = async ({
	driver,
	invocation,
	activity,
	spawn,
	reemit,
}: Params): Promise<{ ok: true; result: DriverResult } | { ok: false; failure: string }> => {
	const startedAt = new Date();
	let streamed: HarnessProcessUsage | undefined;
	let rung: { ok: true; result: DriverResult } | { ok: false; failure: string };
	let endReason: ProcessEndReason;
	let usage: HarnessProcessUsage | undefined;

	try {
		const result = await driver.invoke({
			...invocation,
			onUsage: (reported) => {
				streamed = reported;
			},
		});

		rung = { ok: true, result };
		endReason = result.rateLimited ? ProcessEndReason.RateLimited : ProcessEndReason.Completed;
		usage = result.usage ?? streamed;
	} catch (error) {
		// Timeouts and spawn failures are step failures the engine records
		// and the run resumes from — never uncaught crashes that zombie the
		// manifest. No blind retry: a second identical timeout just doubles
		// the cost of learning the ceiling is too low.
		rung = { ok: false, failure: `agent invocation failed: ${messageOf({ error })}` };
		endReason =
			invocation.timeoutMs !== undefined && Date.now() - startedAt.getTime() >= invocation.timeoutMs ? ProcessEndReason.TimedOut : ProcessEndReason.Failed;
		usage = streamed;
	}

	const endedAt = new Date();

	try {
		activity?.recordProcess({
			harness: driver.name,
			model: invocation.model,
			effort: invocation.effort,
			spawn,
			reemit,
			startedAt: startedAt.toISOString(),
			endedAt: endedAt.toISOString(),
			endReason,
			usage,
		});
	} catch {
		// Evidence never fails the work it describes.
	}

	return rung;
};
