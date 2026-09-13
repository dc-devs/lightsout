import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { isPidAlive } from '#src/runState/index.ts';
import { ticketFileNames } from '#src/ticket/common/constants/ticketFileNames.ts';

interface Params<Result> {
	/** The ticket's folder in the primary checkout — created here when it is not there yet. */
	ticketFolder: string;
	run: () => Promise<Result>;
}

/** Who holds the lock: enough to tell a live writer from a leftover, and to release only our own. */
const LockHolder = z.object({ pid: z.number(), token: z.string(), acquiredAt: z.string() });

const sleep = ({ ms }: { ms: number }) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The holder on disk, or undefined when nothing is there and when what is there will not parse. */
const readHolder = ({ lockPath }: { lockPath: string }) => {
	let holder: z.infer<typeof LockHolder> | undefined;

	try {
		holder = LockHolder.parse(JSON.parse(readFileSync(lockPath, 'utf8')));
	} catch {
		holder = undefined;
	}

	return holder;
};

/**
 * Move a leftover out of the way by renaming it aside under a name only this
 * acquisition produces — never by unlinking it.
 *
 * Two callers can both judge one leftover reclaimable, and an unlink from the
 * second would delete the first one's freshly created lock, leaving two writers
 * on one record. A rename whose source is already gone fails instead, so
 * exactly one of them wins and the loser simply polls again.
 */
const claimLeftover = ({ lockPath, token }: { lockPath: string; token: string }) => {
	const asidePath = `${lockPath}.claim-${process.pid}-${token}`;
	let claimed = false;

	try {
		renameSync(lockPath, asidePath);
		claimed = true;
	} catch {
		claimed = false;
	}

	if (claimed) {
		try {
			unlinkSync(asidePath);
		} catch {
			// The moved-aside document is dead weight either way; failing to remove
			// it must never stop the lock it just freed from being taken.
		}
	}

	return claimed;
};

/** One exclusive-create attempt: taken, already there, or a filesystem failure that no retry would fix. */
const createLock = ({ lockPath, token }: { lockPath: string; token: string }) => {
	let outcome: { created: true } | { present: true } | { failure: string };

	try {
		writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`, { flag: 'wx' });

		outcome = { created: true };
	} catch (error) {
		const present = typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

		outcome = present ? { present: true } : { failure: messageOf({ error }) };
	}

	return outcome;
};

/**
 * Take the record's lock, waiting while another writer holds it.
 *
 * Every filesystem access is synchronous. A lock is a check-then-act, and doing
 * it on one turn is what stops anything else in this process interleaving
 * between reading a holder and taking the record it left.
 *
 * A holder whose process is gone, and a document that will not parse on a
 * second read, are leftovers: they are claimed and the attempt is retried at
 * once, with no wait at all. The second read is what keeps a lock written
 * between the first read and the create from being judged a leftover.
 */
const acquireLock = async ({ lockPath, token }: { lockPath: string; token: string }) => {
	const pollIntervalMs = 100;
	const waitCeilingMs = 10_000;
	const startedAt = Date.now();

	let outcome: { acquired: true } | { error: string } | undefined;
	let heldBy: number | undefined;

	while (outcome === undefined) {
		const holder = readHolder({ lockPath });
		let retryAtOnce = false;

		if (holder !== undefined) {
			heldBy = holder.pid;
			retryAtOnce = !isPidAlive({ pid: holder.pid }) && claimLeftover({ lockPath, token });
		} else {
			const attempt = createLock({ lockPath, token });

			if ('created' in attempt) {
				outcome = { acquired: true };
			} else if ('failure' in attempt) {
				outcome = { error: `the ticket record lock ${lockPath} could not be taken: ${attempt.failure}` };
			} else {
				// A document is at that path which would not parse a moment ago: a
				// truncated write, and a leftover like any other — unless a whole one
				// landed in between, which the second read is what tells apart.
				retryAtOnce = readHolder({ lockPath }) === undefined ? claimLeftover({ lockPath, token }) : true;
			}
		}

		if (outcome === undefined && !retryAtOnce) {
			if (Date.now() - startedAt >= waitCeilingMs) {
				outcome = {
					error: `the ticket record lock ${lockPath} is held by process ${heldBy ?? 'unknown'} and was still held after ${waitCeilingMs / 1000} seconds — wait for that command to finish, or remove the lock file if that process is gone`,
				};
			} else {
				await sleep({ ms: pollIntervalMs });
			}
		}
	}

	return outcome;
};

/** Hand the lock back, but only our own — a document another caller has since reclaimed is left exactly where it is. */
const releaseLock = ({ lockPath, token }: { lockPath: string; token: string }) => {
	if (readHolder({ lockPath })?.token !== token) {
		return;
	}

	try {
		unlinkSync(lockPath);
	} catch {
		// Already gone, or gone by another hand: either way the record is free.
	}
};

/**
 * Hold a ticket record's exclusive lock for the whole of one read-modify-write,
 * or answer why the lock was never taken.
 *
 * Mirrors `withGateLock`: exclusive create, a bounded wait, release in a
 * `finally` on every exit path. The gate lock itself is not reused — it is
 * keyed to the machine rather than to one record, waits thirty minutes, and
 * records gate process groups.
 *
 * This is the lock-ordering invariant's half: nothing inside `run` takes
 * another lock, and the lock is never held across a tracker call or a gate run,
 * both of which happen before or after this call.
 */
export const withTicketRecordLock = async <Result>({ ticketFolder, run }: Params<Result>): Promise<Result | { error: string }> => {
	try {
		mkdirSync(ticketFolder, { recursive: true });
	} catch (error) {
		return { error: `the ticket folder ${ticketFolder} could not be created: ${messageOf({ error })}` };
	}

	const lockPath = join(ticketFolder, ticketFileNames.lock);
	const token = randomUUID();
	const acquisition = await acquireLock({ lockPath, token });

	if ('error' in acquisition) {
		return acquisition;
	}

	try {
		return await run();
	} finally {
		releaseLock({ lockPath, token });
	}
};
