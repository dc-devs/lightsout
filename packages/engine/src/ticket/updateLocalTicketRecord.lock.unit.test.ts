import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, jest, test } from '@jest/globals';
import type { WorkOrderState } from '#src/contracts/index.ts';
import { updateLocalTicketRecord } from '#src/ticket/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';

// Mocked Imports
// -------------------------
// Which checkout holds the one record is answered through git, which this unit
// does not own — and every test here needs the record under its own temp folder
// rather than under whatever repository the suite happens to run in.
const mockResolveSharedStateDir = jest.fn<(params: { cwd: string }) => Promise<string>>();

jest.mock('#src/common/workspace/resolveSharedStateDir.ts', () => ({
	resolveSharedStateDir: (params: { cwd: string }) => mockResolveSharedStateDir(params),
}));
// -------------------------

/** The ticket folder's name, which is also the branch every record below names. */
const ticketBranch = 'lo-140-multi';

/** Beyond any OS pid range — process.kill(pid, 0) reports ESRCH, i.e. dead. */
const deadPid = 999_999_999;

/** Permission bits do not apply to root, so the refused lock they provoke is unreachable there. */
// Jest has no per-call `{ skip }` option, so the choice is made at the call site.
const testUnlessRoot = process.getuid?.() === 0 ? test.skip : test;

/** What the caller gets back: a record, or one sentence saying why nothing was written. */
type Outcome = { record: WorkOrderState } | { error: string };

/** The refusal sentence, or an empty string when the update went through. */
const errorOf = ({ outcome }: { outcome: Outcome }): string => ('error' in outcome ? outcome.error : '');

const recordWith = ({ history }: { history: WorkOrderState['history'] }): WorkOrderState => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: ticketBranch,
	mode: 'single-plan',
	plans: [],
	history,
});

/** A change that keeps every event already recorded and adds one of its own, which is the only shape the store accepts. */
const appendEvent =
	({ detail }: { detail: string }) =>
	(current: WorkOrderState | undefined): WorkOrderState =>
		recordWith({ history: [...(current?.history ?? []), { at: '2026-09-11T00:00:00.000Z', kind: 'plan-added', detail }] });

/** The details of every event on the record now on disk, which is how each test reads what landed. */
const detailsOn = ({ recordPath }: { recordPath: string }): string[] => {
	const { history } = JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState;

	return history.map(({ detail }) => detail);
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

	for (let elapsedMs = 0; elapsedMs <= limitMs && !settled; elapsedMs += 100) {
		await jest.advanceTimersByTimeAsync(100);
	}

	return done;
};

interface SetupParams {
	/** A record already at ticket.json when the caller starts. */
	record?: WorkOrderState;
	/** What is already at the lock path: a document naming a pid, bytes that will not parse, or a directory no unlink can remove. */
	heldBy?: { pid: number } | 'unparseable' | 'unclearable';
	/** Strip write permission from the ticket folder, so no file can be created in it at all. */
	readOnlyFolder?: boolean;
	/** Fake time, for the rows that have to reach the ten-second ceiling without spending ten seconds. */
	fakeTimers?: boolean;
}

// A folder made read-only mid-test must be writable again, or the temp tree it
// sits in cannot be removed. Recorded at file scope so one hook restores them.
const lockedFolders: string[] = [];

const setupTicketRecord = ({ record, heldBy, readOnlyFolder = false, fakeTimers = false }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-lock-'));
	const ticketFolder = join(cwd, '.lightsout', 'tickets', ticketBranch);
	const recordPath = join(ticketFolder, 'ticket.json');
	const lockPath = join(ticketFolder, 'ticket.lock');

	// Derived from the cwd it is asked about rather than pinned to one folder, so
	// the tests that arrange two temp checkouts send each caller at its own.
	mockResolveSharedStateDir.mockImplementation(({ cwd: asked }) => Promise.resolve(join(asked, '.lightsout')));

	if (record !== undefined || heldBy !== undefined || readOnlyFolder) {
		mkdirSync(ticketFolder, { recursive: true });
	}

	if (record !== undefined) {
		writeFileSync(recordPath, `${JSON.stringify(record, null, '\t')}\n`, 'utf8');
	}

	if (heldBy === 'unparseable') {
		writeFileSync(lockPath, 'half a wri', 'utf8');
	} else if (heldBy === 'unclearable') {
		mkdirSync(lockPath, { recursive: true });
	} else if (heldBy !== undefined) {
		writeFileSync(lockPath, JSON.stringify({ pid: heldBy.pid, token: 'another-acquisition', acquiredAt: new Date().toISOString() }), 'utf8');
	}

	if (readOnlyFolder) {
		chmodSync(ticketFolder, 0o555);
		lockedFolders.push(ticketFolder);
	}

	if (fakeTimers) {
		jest.useFakeTimers();
	}

	return { cwd, ticketFolder, recordPath, lockPath };
};

afterEach(() => {
	// Fake time outlives the test that asked for it, so it is handed back here
	// rather than at the end of a body a failed assertion can skip.
	jest.useRealTimers();

	for (const folder of lockedFolders.splice(0)) {
		chmodSync(folder, 0o755);
	}
});

describe('updateLocalTicketRecord', () => {
	test('applies both of two concurrent changes so neither update is lost', async () => {
		const { cwd, recordPath } = setupTicketRecord();

		const outcomes = await Promise.all([
			updateLocalTicketRecord({ cwd, ticketBranch, change: appendEvent({ detail: 'added 001-record' }) }),
			updateLocalTicketRecord({ cwd, ticketBranch, change: appendEvent({ detail: 'added 002-queue-order' }) }),
		]);

		// The second caller has to read what the first one wrote: a change that saw
		// the record as it was before the first update would drop that event.
		expect({
			refusals: outcomes.map((outcome) => errorOf({ outcome })).filter((reason) => reason !== ''),
			details: detailsOn({ recordPath }).sort(),
		}).toStrictEqual({ refusals: [], details: ['added 001-record', 'added 002-queue-order'] });
	});

	test('waits for a live holder and answers an error naming the lock and its pid after ten seconds', async () => {
		const { cwd, recordPath } = setupTicketRecord({ record: recordWith({ history: [] }), heldBy: { pid: process.pid }, fakeTimers: true });
		const before = readFileSync(recordPath, 'utf8');
		const mockChange = jest.fn<(current: WorkOrderState | undefined) => WorkOrderState>();

		const outcome = await advanceUntilSettled({ promise: updateLocalTicketRecord({ cwd, ticketBranch, change: mockChange }), limitMs: 15_000 });

		const reason = errorOf({ outcome });

		expect(reason).toContain('ticket.lock');
		expect(reason).toContain(String(process.pid));
		// The machine is genuinely taken, so the record must read exactly as it did
		// before — a change applied beside another writer is the loss this pins.
		expect({ changesRun: mockChange.mock.calls.length, onDisk: readFileSync(recordPath, 'utf8') }).toStrictEqual({ changesRun: 0, onDisk: before });
	});

	test('reclaims a lock left by a dead process or one that will not parse and applies the change', async () => {
		const stale = setupTicketRecord({ heldBy: { pid: deadPid } });
		const corrupt = setupTicketRecord({ heldBy: 'unparseable' });

		const afterStale = await updateLocalTicketRecord({ cwd: stale.cwd, ticketBranch, change: appendEvent({ detail: 'reclaimed a dead holder' }) });
		const afterCorrupt = await updateLocalTicketRecord({ cwd: corrupt.cwd, ticketBranch, change: appendEvent({ detail: 'reclaimed an unparseable lock' }) });

		// Neither leftover is a writer anybody has to wait for, and no timer was ever
		// advanced here — a call that slept at all would still be sleeping.
		expect({
			staleRefusal: errorOf({ outcome: afterStale }),
			staleDetails: detailsOn({ recordPath: stale.recordPath }),
			corruptRefusal: errorOf({ outcome: afterCorrupt }),
			corruptDetails: detailsOn({ recordPath: corrupt.recordPath }),
		}).toStrictEqual({
			staleRefusal: '',
			staleDetails: ['reclaimed a dead holder'],
			corruptRefusal: '',
			corruptDetails: ['reclaimed an unparseable lock'],
		});
	});

	test('releases the lock after a change that throws so the next update succeeds', async () => {
		const { cwd, recordPath, lockPath } = setupTicketRecord();
		const failure = new Error('the change could not build a record');

		const thrown = await getRejectionError({
			promise: updateLocalTicketRecord({
				cwd,
				ticketBranch,
				change: () => {
					throw failure;
				},
			}),
		});
		const next = await updateLocalTicketRecord({ cwd, ticketBranch, change: appendEvent({ detail: 'added 001-record' }) });

		expect(thrown).toBe(failure);
		// A lock left by a thrown change would take the record out of service for
		// ten seconds per caller and then refuse every one of them.
		expect({ left: existsSync(lockPath), nextRefusal: errorOf({ outcome: next }), details: detailsOn({ recordPath }) }).toStrictEqual({
			left: false,
			nextRefusal: '',
			details: ['added 001-record'],
		});
	});

	test('leaves no ticket.lock behind after a successful update', async () => {
		const { cwd, lockPath } = setupTicketRecord();

		const outcome = await updateLocalTicketRecord({ cwd, ticketBranch, change: appendEvent({ detail: 'added 001-record' }) });

		expect({ refusal: errorOf({ outcome }), left: existsSync(lockPath) }).toStrictEqual({ refusal: '', left: false });
	});

	test('reclaims a lock path holding something no unlink can remove and applies the change', async () => {
		const { cwd, recordPath } = setupTicketRecord({ heldBy: 'unclearable' });

		const outcome = await updateLocalTicketRecord({ cwd, ticketBranch, change: appendEvent({ detail: 'added 001-record' }) });

		// Nothing there is a writer to wait for, and no timer was advanced here —
		// a leftover that resists removal must still be moved out of the way.
		expect({ refusal: errorOf({ outcome }), details: detailsOn({ recordPath }) }).toStrictEqual({ refusal: '', details: ['added 001-record'] });
	});

	test('leaves in place a lock another acquisition has since taken', async () => {
		const { cwd, lockPath, recordPath } = setupTicketRecord();
		const foreignHolder = JSON.stringify({ pid: process.pid, token: 'another-acquisition', acquiredAt: '2026-09-11T00:00:00.000Z' });

		const outcome = await updateLocalTicketRecord({
			cwd,
			ticketBranch,
			change: (current) => {
				// Whoever reclaimed this record's lock mid-update holds it now, and a
				// release that removed a lock it no longer owns would leave that
				// writer working with no guard at all.
				writeFileSync(lockPath, foreignHolder, 'utf8');

				return appendEvent({ detail: 'added 001-record' })(current);
			},
		});

		expect({ refusal: errorOf({ outcome }), holder: readFileSync(lockPath, 'utf8'), details: detailsOn({ recordPath }) }).toStrictEqual({
			refusal: '',
			holder: foreignHolder,
			details: ['added 001-record'],
		});
	});

	testUnlessRoot('answers an error naming the lock when the ticket folder accepts no new files', async () => {
		const { cwd, lockPath, recordPath } = setupTicketRecord({ readOnlyFolder: true });
		const mockChange = jest.fn<(current: WorkOrderState | undefined) => WorkOrderState>();

		const outcome = await updateLocalTicketRecord({ cwd, ticketBranch, change: mockChange });

		expect({ reason: errorOf({ outcome }), changesRun: mockChange.mock.calls.length, wrote: existsSync(recordPath) }).toEqual({
			reason: expect.stringContaining(lockPath),
			changesRun: 0,
			wrote: false,
		});
	});

	testUnlessRoot('answers an error naming the lock when it can be neither taken nor moved aside', async () => {
		const { cwd, lockPath, recordPath } = setupTicketRecord({ heldBy: 'unclearable', readOnlyFolder: true, fakeTimers: true });
		const mockChange = jest.fn<(current: WorkOrderState | undefined) => WorkOrderState>();

		const outcome = await advanceUntilSettled({ promise: updateLocalTicketRecord({ cwd, ticketBranch, change: mockChange }), limitMs: 15_000 });

		// A leftover that can be neither read, taken nor renamed aside is the one
		// case that runs the wait out: the caller is told, never written beside.
		expect({ reason: errorOf({ outcome }), changesRun: mockChange.mock.calls.length, wrote: existsSync(recordPath) }).toEqual({
			reason: expect.stringContaining(lockPath),
			changesRun: 0,
			wrote: false,
		});
	});
});
