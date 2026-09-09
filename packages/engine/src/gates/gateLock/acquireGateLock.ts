import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { GateLock } from '#src/contracts/index.ts';
import { gateLockTimings } from '#src/gates/gateLock/common/constants/gateLockTimings.ts';
import { describeGateLockHolder } from '#src/gates/gateLock/common/utils/describeGateLockHolder.ts';
import { isGateLockReclaimable } from '#src/gates/gateLock/common/utils/isGateLockReclaimable.ts';
import { readGateLock } from '#src/gates/gateLock/readGateLock.ts';

interface Params {
	/** Already resolved by `withGateLock`, so the git call that produced it is paid once per gate run rather than once per poll. */
	lockPath: string;
	/** The checkout recorded on the document, which is the worktree a waiter names. */
	cwd: string;
	runId: string;
	/** The ceiling for this call. Zero means one attempt and no wait. */
	waitCeilingMs: number;
	onProgress?: (message: string) => void;
}

interface Acquisition {
	acquired: boolean;
	/** The run that still holds it when `acquired` is false — undefined when the document could not be read. */
	holder: GateLock | undefined;
	waitedMs: number;
	/** The filesystem error that stopped the reservation being taken at all — set only for a failure that is not a conflicting holder, and never set beside a holder. */
	failure: string | undefined;
}

const sleep = ({ ms }: { ms: number }) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const codeOf = ({ error }: { error: unknown }) => (typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined);

/**
 * Take a leftover reservation out of the way by renaming it aside, under a name
 * only this waiter can produce — never by unlinking it.
 *
 * Two waiters can both judge the same leftover reclaimable, and an unlink from
 * the second would delete the first one's freshly created reservation, leaving
 * two gate runs on one machine. A rename whose source is already gone fails
 * instead, so of two waiters exactly one wins the reclaim and the loser simply
 * polls again.
 */
const claimLeftover = ({ lockPath, runId }: { lockPath: string; runId: string }) => {
	const asidePath = `${lockPath}.claim-${process.pid}-${runId}`;

	try {
		renameSync(lockPath, asidePath);
	} catch {
		return false;
	}

	try {
		unlinkSync(asidePath);
	} catch {
		// The moved-aside document is dead weight either way; failing to remove it
		// must never stop the reservation it just freed from being taken.
	}

	return true;
};

/**
 * One exclusive-create attempt, classified.
 *
 * `present` means a document is already at that path, which is the only thing
 * `EEXIST` says — whether it belongs to a live run is the caller's to judge,
 * from what it reads back. `ENOENT` under an existing checkout is a repository
 * whose shared `.lightsout` is not there yet, so the folder is created and the
 * caller simply attempts again; the create either makes the directory or
 * reports why it could not, which is what keeps the retry from repeating.
 */
const createReservation = ({ lockPath, cwd, runId }: { lockPath: string; cwd: string; runId: string }) => {
	// The default is the retry-at-once case: nothing is there, nothing failed,
	// and the caller simply attempts again. Every branch below states its own
	// triple against it, and the one return is what keeps the caller — which
	// reads `created`, then `failure`, then `present`, in that order — from ever
	// meeting a pair no branch meant to set.
	let outcome: { created: boolean; present: boolean; failure: string | undefined } = { created: false, present: false, failure: undefined };

	try {
		const payload = { pid: process.pid, runId, worktree: cwd, startedAt: new Date().toISOString(), gateGroups: [] };

		writeFileSync(lockPath, `${JSON.stringify(payload, null, '\t')}\n`, { flag: 'wx' });

		outcome = { created: true, present: false, failure: undefined };
	} catch (error) {
		const code = codeOf({ error });

		// ENOENT is every repository's first gate run: the shared folder is not
		// there yet. Its PARENT is the checkout itself, which must already exist —
		// creating that too would let a gate run fabricate the very working
		// directory whose absence is the real fault, and then report green from
		// inside an empty folder nobody asked for.
		const sharedFolderMissing = code === 'ENOENT' && existsSync(dirname(dirname(lockPath)));

		if (code === 'EEXIST') {
			outcome = { created: false, present: true, failure: undefined };
		} else if (!sharedFolderMissing) {
			outcome = { created: false, present: false, failure: messageOf({ error }) };
		} else {
			try {
				mkdirSync(dirname(lockPath), { recursive: true });
			} catch (mkdirError) {
				outcome = { created: false, present: false, failure: messageOf({ error: mkdirError }) };
			}
		}
	}

	return outcome;
};

/**
 * Take the shared gate reservation, waiting for it while another gate run has
 * the machine.
 *
 * Every file access here is synchronous. A lock is a check-then-act, and doing
 * it on one turn is what stops anything else in this process interleaving
 * between reading a holder and taking the machine it left; the cost is one
 * small file read per two-second poll.
 *
 * The reservation is taken with an exclusive create, mirroring `acquireRunLock`,
 * so two simultaneous starts can never both win. Each poll reads the document
 * first and only attempts the create when there is nothing live at that path:
 * the common case — another gate run holding the machine — then costs one read,
 * which is what lets a waiting run say so promptly rather than after a round of
 * writes that were never going to succeed.
 *
 * A document `isGateLockReclaimable` accepts, and one that will not parse at
 * all, are leftovers: they are claimed and the attempt is retried at once. A
 * document that will not parse is confirmed still unparseable before it is
 * claimed, so a reservation written between the read and the create is judged
 * as the live holder it is rather than moved aside.
 *
 * A wait that expires answers `acquired: false` with the holder it was waiting
 * on. Any other filesystem failure — an unwritable or unreadable shared folder,
 * `EACCES`, `EROFS`, a full disk — answers with the error's own message in
 * `failure` instead, which is what lets a caller tell that apart from a busy
 * machine. It never throws: all four gate callers destructure a returned result
 * and none expects an exception mid-pipeline. It never runs the gates
 * uncoordinated either.
 *
 * The first attempt happens before any sleep, so an uncontended run pauses for
 * nothing at all — and that is the whole of the call when `waitCeilingMs` is
 * zero. A zero ceiling suppresses the sleeping and nothing else: the reclaim
 * path still runs, because a leftover is a free machine and a free machine must
 * never be reported busy.
 */
export const acquireGateLock = async ({ lockPath, cwd, runId, waitCeilingMs, onProgress }: Params): Promise<Acquisition> => {
	const startedAt = Date.now();

	let outcome: Acquisition | undefined;
	let announcedAt: number | undefined;

	while (outcome === undefined) {
		const holder = readGateLock({ lockPath });
		// Set when this pass changed something the next attempt can act on, which
		// is what makes the retry immediate instead of a poll away. A pass that
		// changed nothing always falls through to the wait below, so a leftover
		// nobody can claim — a corrupt document under a read-only folder — costs a
		// poll each time round rather than spinning the loop.
		let retryAtOnce = false;

		if (holder !== undefined) {
			retryAtOnce = isGateLockReclaimable({ lock: holder }) && claimLeftover({ lockPath, runId });
		} else {
			const attempt = createReservation({ lockPath, cwd, runId });

			if (attempt.created) {
				outcome = { acquired: true, holder: undefined, waitedMs: Date.now() - startedAt, failure: undefined };
			} else if (attempt.failure !== undefined) {
				outcome = { acquired: false, holder: undefined, waitedMs: Date.now() - startedAt, failure: attempt.failure };
			} else if (!attempt.present) {
				retryAtOnce = true;
			} else {
				// A document is at that path which would not parse a moment ago: a
				// truncated write, and a leftover like any other — unless a live run
				// wrote a whole one in between, which is what the second read tells
				// apart, so a fresh reservation is never moved aside.
				retryAtOnce = readGateLock({ lockPath }) === undefined ? claimLeftover({ lockPath, runId }) : true;
			}
		}

		if (outcome === undefined && !retryAtOnce) {
			const waitedMs = Date.now() - startedAt;

			if (waitedMs >= waitCeilingMs) {
				outcome = { acquired: false, holder, waitedMs, failure: undefined };
			} else {
				if (announcedAt === undefined || waitedMs - announcedAt >= gateLockTimings.progressIntervalMs) {
					announcedAt = waitedMs;
					onProgress?.(`gate reservation: waiting for the machine — ${describeGateLockHolder({ lock: holder })}`);
				}

				await sleep({ ms: gateLockTimings.pollIntervalMs });
			}
		}
	}

	return outcome;
};
