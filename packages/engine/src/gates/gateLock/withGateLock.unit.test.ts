import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { type GateLockOutcome, withGateLock } from '#src/gates/gateLock/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

// Mocked Imports
// -------------------------
// The shared folder is resolved through git, which this unit does not own — and
// how MANY times it is asked is one of the contracts stated below, so the call
// has to be countable.
const mockResolveSharedStateDir = jest.fn<(params: { cwd: string }) => Promise<string>>();

jest.mock('#src/common/workspace/resolveSharedStateDir.ts', () => ({
	resolveSharedStateDir: (params: { cwd: string }) => mockResolveSharedStateDir(params),
}));
// -------------------------
// Which recorded gate groups are still burning the machine is the second half of
// the reclaim rule. Declaring it beats spawning real detached children, whose
// exit this file cannot time.
const mockIsProcessGroupAlive = jest.fn<(params: { pgid: number }) => boolean>();

jest.mock('#src/common/processes/isProcessGroupAlive.ts', () => ({
	isProcessGroupAlive: (params: { pgid: number }) => mockIsProcessGroupAlive(params),
}));
// -------------------------

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

/** Another gate run, still executing: its pid is alive, so the machine is genuinely taken. */
const liveHolder = { pid: process.pid, runId: 'gates-in-flight', worktree: '/repo/.worktrees/lo-118-queue', ageMs: 7 * 60_000, gateGroups: [4242] };

/** What a killed engine leaves behind: the holder is gone, but it recorded the gate group it spawned. */
const leftover = { pid: deadPid, runId: 'killed-run', worktree: '/repo/.worktrees/lo-117-crash', ageMs: 60_000, gateGroups: [8181] };

/** The document another run leaves at our path once it has judged our reservation reclaimable and taken the machine. */
const reclaimerDocument = () => ({
	pid: process.pid,
	runId: 'reclaimer-run',
	worktree: '/repo/.worktrees/lo-120-next',
	startedAt: new Date().toISOString(),
	gateGroups: [],
});

interface SetupParams {
	/** A reservation already on disk when the caller starts. */
	heldBy?: { pid: number; runId: string; worktree: string; ageMs: number; gateGroups: number[] };
	/** Plant bytes that will not parse at the reservation path — a half-finished write. */
	corrupt?: boolean;
	/** Put the shared folder under a plain file, so no reservation can be created at all. */
	unwritable?: boolean;
	/** The recorded gate groups that still have a live process. */
	liveGroups?: number[];
	/** Real timers, for the one test that has to let queued writes land rather than wait for anything. */
	fakeTimers?: boolean;
}

const setupGateLock = ({ heldBy, corrupt = false, unwritable = false, liveGroups = [], fakeTimers = true }: SetupParams = {}) => {
	const root = mkdtempSync(join(tmpdir(), 'lightsout-gate-lock-'));
	// A directory can never be made under a plain file — not even by root — so the
	// shared folder is unreachable for every step that touches it: the mkdir, the
	// exclusive create, the read and the rename all answer ENOTDIR.
	const cwd = unwritable ? join(root, 'blocked') : root;
	const stateDir = join(cwd, '.lightsout');
	const lockPath = join(stateDir, 'gate-lock.json');
	const progress: string[] = [];
	const entered: string[] = [];

	if (unwritable) {
		writeFileSync(cwd, 'a file where a checkout should be', 'utf8');
	} else {
		mkdirSync(stateDir, { recursive: true });
	}

	// Derived from the cwd it is asked about, not pinned to this setup's folder:
	// one test arranges two repos, and a pinned value would send both callers at
	// the same file.
	mockResolveSharedStateDir.mockImplementation(({ cwd: asked }) => Promise.resolve(join(asked, '.lightsout')));
	mockIsProcessGroupAlive.mockImplementation(({ pgid }) => liveGroups.includes(pgid));

	if (fakeTimers) {
		jest.useFakeTimers();
	}

	if (heldBy) {
		const { ageMs, ...held } = heldBy;

		writeFileSync(lockPath, JSON.stringify({ ...held, startedAt: new Date(Date.now() - ageMs).toISOString() }), 'utf8');
	}

	if (corrupt) {
		writeFileSync(lockPath, 'half a wri', 'utf8');
	}

	return {
		cwd,
		lockPath,
		progress,
		entered,
		onProgress: (message: string) => progress.push(message),
		/** The gate run itself — a reservation that was refused must never enter it. */
		runBody: async () => {
			entered.push('gates ran');

			return 'gates ran';
		},
	};
};

/**
 * Fake time in poll-sized steps until the call settles. One long jump can outrun
 * the real filesystem work between polls, leaving the next sleep scheduled past
 * the point the clock ever reaches.
 */
const advanceUntilSettled = async <Result>({ promise, limitMs }: { promise: Promise<Result>; limitMs: number }): Promise<Result> => {
	let settled = false;
	const done = promise.then((value) => {
		settled = true;

		return value;
	});

	for (let elapsedMs = 0; elapsedMs <= limitMs && !settled; elapsedMs += 2_000) {
		await jest.advanceTimersByTimeAsync(2_000);
	}

	return done;
};

/** The refusal sentence, or an empty string when the machine was taken after all. */
const reasonOf = ({ outcome }: { outcome: GateLockOutcome<unknown> }): string => ('coordination' in outcome ? outcome.coordination : '');

/** The gate process groups the reservation currently claims are running. */
const groupsOn = ({ lockPath }: { lockPath: string }): number[] => {
	const { gateGroups } = JSON.parse(readFileSync(lockPath, 'utf8')) as { gateGroups: number[] };

	return [...gateGroups].sort();
};

describe('withGateLock', () => {
	test('takes an uncontended reservation without pausing or narrating, and leaves nothing behind', async () => {
		const { cwd, lockPath, progress, onProgress, runBody } = setupGateLock();

		const outcome = await withGateLock({ cwd, runId: 'run-a', onProgress, run: runBody });

		// no timer was ever advanced, so anything that slept would still be waiting
		expect({ outcome, progress, left: existsSync(lockPath) }).toStrictEqual({ outcome: { held: 'gates ran' }, progress: [], left: false });
	});

	test('waits for a live holder, naming the run and worktree holding the machine, and proceeds when it is freed', async () => {
		const { cwd, lockPath, progress, onProgress, runBody } = setupGateLock({ heldBy: liveHolder });

		const waiting = withGateLock({ cwd, runId: 'run-b', onProgress, run: runBody });
		await jest.advanceTimersByTimeAsync(4_000);
		const entryLine = progress[0] ?? '';
		rmSync(lockPath);
		// an eight-second budget: a freed machine is picked up on the next two-second
		// poll, not thirty seconds later
		const outcome = await advanceUntilSettled({ promise: waiting, limitMs: 8_000 });

		expect(outcome).toStrictEqual({ held: 'gates ran' });
		expect(entryLine).toContain('gates-in-flight');
		expect(entryLine).toContain('/repo/.worktrees/lo-118-queue');
		// how long the machine has been held, from the reservation's startedAt
		expect(entryLine).toMatch(/7\s*m|420/);
	});

	test('rate-limits the waiting line to one every thirty seconds while polling every two', async () => {
		const { cwd, progress, onProgress, runBody } = setupGateLock({ heldBy: liveHolder });

		const waiting = withGateLock({ cwd, runId: 'run-b', waitCeilingMs: 130_000, onProgress, run: runBody });
		for (let poll = 0; poll < 60; poll += 1) {
			await jest.advanceTimersByTimeAsync(2_000);
		}
		const linesInTwoMinutes = [...progress];
		await advanceUntilSettled({ promise: waiting, limitMs: 60_000 });

		// sixty polls happened in those two minutes: the reader gets the entry line
		// and one line per thirty seconds, never one per poll
		expect(linesInTwoMinutes.length).toBeLessThanOrEqual(5);
		expect(linesInTwoMinutes.length).toBeGreaterThanOrEqual(4);
		expect(linesInTwoMinutes.every((line) => line.includes('gates-in-flight'))).toBe(true);
	});

	test('gives up at the thirty-minute ceiling with a coordination reason, having never run the body', async () => {
		const { cwd, entered, onProgress, runBody } = setupGateLock({ heldBy: liveHolder });

		const outcome = await advanceUntilSettled({ promise: withGateLock({ cwd, runId: 'run-b', onProgress, run: runBody }), limitMs: 32 * 60_000 });

		expect(reasonOf({ outcome })).toContain('gates-in-flight');
		// nothing ran, so this red is not a verdict about anybody's code
		expect(entered).toStrictEqual([]);
	});

	test('reclaims a reservation whose holder is dead and whose gate groups have all exited', async () => {
		const { cwd, lockPath, runBody } = setupGateLock({ heldBy: leftover });

		const outcome = await withGateLock({ cwd, runId: 'run-b', run: runBody });

		expect({ outcome, left: existsSync(lockPath) }).toStrictEqual({ outcome: { held: 'gates ran' }, left: false });
	});

	test('refuses to reclaim a dead holder that still has a live gate process group', async () => {
		const { cwd, lockPath, entered, runBody } = setupGateLock({ heldBy: leftover, liveGroups: [8181] });

		const outcome = await advanceUntilSettled({ promise: withGateLock({ cwd, runId: 'run-b', waitCeilingMs: 10_000, run: runBody }), limitMs: 14_000 });

		// orphaned gates are still burning the machine, so it waited rather than
		// stacking a second run's suites on top of them
		expect(entered).toStrictEqual([]);
		expect(reasonOf({ outcome })).not.toBe('');
		expect((JSON.parse(readFileSync(lockPath, 'utf8')) as { runId: string }).runId).toBe('killed-run');
	});

	test('treats an unparseable reservation as a leftover rather than a live holder', async () => {
		const { cwd, lockPath, runBody } = setupGateLock({ corrupt: true });

		const outcome = await withGateLock({ cwd, runId: 'run-b', run: runBody });

		expect({ outcome, left: existsSync(lockPath) }).toStrictEqual({ outcome: { held: 'gates ran' }, left: false });
	});

	test('lets exactly one of two simultaneous callers claim the same leftover', async () => {
		const { cwd, entered } = setupGateLock({ heldBy: leftover });
		let releaseBody = (): void => undefined;
		const bodyHeld = new Promise<void>((resolve) => {
			releaseBody = resolve;
		});
		/** Enters, then keeps the machine until the test lets go — so "who is running" can be read while one caller holds it. */
		const holdingBody = async () => {
			entered.push('gates ran');
			await bodyHeld;

			return 'gates ran';
		};

		const first = withGateLock({ cwd, runId: 'run-a', run: holdingBody });
		const second = withGateLock({ cwd, runId: 'run-b', run: holdingBody });
		await jest.advanceTimersByTimeAsync(6_000);
		const enteredWhileClaimed = [...entered];
		releaseBody();
		await advanceUntilSettled({ promise: Promise.all([first, second]), limitMs: 30_000 });

		// the second caller found a live holder — the winner — and waited for it
		expect({ enteredWhileClaimed: enteredWhileClaimed.length, enteredInTotal: entered.length }).toStrictEqual({ enteredWhileClaimed: 1, enteredInTotal: 2 });
	});

	test('claims a leftover even when told not to wait', async () => {
		const { cwd, runBody } = setupGateLock({ heldBy: leftover });

		const outcome = await withGateLock({ cwd, runId: 'run-b', waitCeilingMs: 0, run: runBody });

		// a leftover is a free machine, and a free machine is never reported busy
		expect(outcome).toStrictEqual({ held: 'gates ran' });
	});

	test('answers a coordination reason rather than throwing when the reservation cannot be written', async () => {
		const { cwd, entered, runBody } = setupGateLock({ unwritable: true });

		const outcome = await advanceUntilSettled({ promise: withGateLock({ cwd, runId: 'run-a', run: runBody }), limitMs: 6_000 });

		// every gate caller destructures a returned result; an exception here would
		// escape mid-pipeline instead
		expect(reasonOf({ outcome })).toContain('ENOTDIR');
		expect(entered).toStrictEqual([]);
	});

	test('tells an unwritable reservation folder apart from a wait that expired', async () => {
		const unwritable = setupGateLock({ unwritable: true });
		const contended = setupGateLock({ heldBy: liveHolder });

		const writeFailure = reasonOf({
			outcome: await advanceUntilSettled({ promise: withGateLock({ cwd: unwritable.cwd, runId: 'run-a', run: unwritable.runBody }), limitMs: 6_000 }),
		});
		const expiredWait = reasonOf({
			outcome: await advanceUntilSettled({
				promise: withGateLock({ cwd: contended.cwd, runId: 'run-b', waitCeilingMs: 6_000, run: contended.runBody }),
				limitMs: 10_000,
			}),
		});

		// an unreachable folder is not a busy machine: telling the reader to wait for
		// a holder that does not exist is the failure this pins
		expect(writeFailure).toContain('ENOTDIR');
		expect(writeFailure).not.toMatch(/wait/i);
		expect(expiredWait).toMatch(/wait/i);
		expect(expiredWait).not.toContain('ENOTDIR');
	});

	test('keeps the group list correct when several gates spawn and exit at once', async () => {
		const { cwd, lockPath } = setupGateLock({ fakeTimers: false });

		const outcome = await withGateLock({
			cwd,
			runId: 'run-a',
			run: async ({ onGateSpawn, onGateExit }) => {
				onGateSpawn({ pid: 101 });
				onGateSpawn({ pid: 202 });
				onGateSpawn({ pid: 303 });
				onGateExit({ pid: 202 });
				await new Promise((resolve) => setTimeout(resolve, 50));

				return groupsOn({ lockPath });
			},
		});

		// the reclaim rule reads this list, so a late write that dropped a running
		// group would hand the machine to a second run
		expect(outcome).toStrictEqual({ held: [101, 303] });
	});

	test('releases the reservation when the body throws, and rethrows', async () => {
		const { cwd, lockPath } = setupGateLock();
		const failure = new Error('the gates crashed');

		const thrown = await getRejectionError({
			promise: withGateLock({
				cwd,
				runId: 'run-a',
				run: async () => {
					throw failure;
				},
			}),
		});

		expect(thrown).toBe(failure);
		// a failed gate run hands the machine back, which is what keeps the repo run
		// lock outer and this reservation inner
		expect(existsSync(lockPath)).toBe(false);
	});

	test('never deletes a reservation that now belongs to another run', async () => {
		const { cwd, lockPath } = setupGateLock();

		await withGateLock({
			cwd,
			runId: 'run-a',
			run: async () => {
				// while we were away, another run judged this reservation reclaimable and
				// took it: the document at our path is no longer ours
				writeFileSync(lockPath, JSON.stringify(reclaimerDocument()), 'utf8');

				return 'gates ran';
			},
		});

		expect((JSON.parse(readFileSync(lockPath, 'utf8')) as { runId: string }).runId).toBe('reclaimer-run');
	});

	test('never records a gate group into a reservation that now belongs to another run', async () => {
		const { cwd, lockPath } = setupGateLock({ fakeTimers: false });

		const outcome = await withGateLock({
			cwd,
			runId: 'run-a',
			run: async ({ onGateSpawn }) => {
				writeFileSync(lockPath, JSON.stringify(reclaimerDocument()), 'utf8');
				onGateSpawn({ pid: 404 });
				await new Promise((resolve) => setTimeout(resolve, 50));

				const { runId, gateGroups } = JSON.parse(readFileSync(lockPath, 'utf8')) as { runId: string; gateGroups: number[] };

				return { runId, gateGroups };
			},
		});

		// the reclaim rule reads that list to decide whether the machine is free, so
		// our group written into the new owner's document would make the new owner
		// look busy with gates that are not its own
		expect(outcome).toStrictEqual({ held: { runId: 'reclaimer-run', gateGroups: [] } });
	});

	test('takes one attempt and refuses at once when told not to wait', async () => {
		const { cwd, entered, progress, onProgress, runBody } = setupGateLock({ heldBy: liveHolder });

		const outcome = await withGateLock({ cwd, runId: 'run-b', waitCeilingMs: 0, onProgress, run: runBody });

		// no timer was advanced: a caller that slept at all would still be sleeping
		expect({ refused: reasonOf({ outcome }) !== '', entered, progress }).toStrictEqual({ refused: true, entered: [], progress: [] });
	});

	test('resolves the reservation path once for the whole wait, not once per poll', async () => {
		const { cwd, onProgress, runBody } = setupGateLock({ heldBy: liveHolder });

		await advanceUntilSettled({ promise: withGateLock({ cwd, runId: 'run-b', onProgress, run: runBody }), limitMs: 32 * 60_000 });

		// nine hundred polls, one git call — the poll loop must not spawn a process
		// per iteration on the machine this reservation exists to unload
		expect(mockResolveSharedStateDir).toHaveBeenCalledTimes(1);
	});
});
