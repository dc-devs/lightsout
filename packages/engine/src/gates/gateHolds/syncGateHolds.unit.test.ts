import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { GateHold } from '#src/contracts/index.ts';
import { syncGateHolds } from '#src/gates/gateHolds/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';

// Mocked Imports
// -------------------------
// Only the tracker itself is doubled. The hold files are written and read for
// real in a temp folder, because what these cases own is which record survives
// a reconcile and which one is left exactly where a concurrent worker put it —
// a claim about bytes on disk, which a mocked writer could not make.
interface ReadParams {
	settings: TrackerSettings;
	identifiers: string[];
}

interface LabelParams {
	settings: TrackerSettings;
	ticketId: string;
	label: string | undefined;
	present: boolean;
}

const mockGetTicketsByIdentifiers = jest.fn<(params: ReadParams) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketLabel = jest.fn<(params: LabelParams) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: ReadParams) => mockGetTicketsByIdentifiers(params),
	setTicketLabel: (params: LabelParams) => mockSetTicketLabel(params),
}));
// -------------------------

const settings: TrackerSettings = { provider: 'linear', team: 'LO', ticketPrefix: 'LO', apiKey: 'lin_key' };

/** The sentence a refused label write answers, distinctive enough to find in the progress lines. */
const refusal = 'the tracker refused the blocked label';

const holdFor = ({ identifier, labelConfirmed }: { identifier: string; labelConfirmed: boolean }): GateHold => ({
	takenAt: '2026-01-01T00:00:00.000Z',
	runId: `run-for-${identifier.toLowerCase()}`,
	worktreePath: `/tmp/worktrees/${identifier.toLowerCase()}`,
	reason: 'the gates never got the machine within the wait ceiling',
	labelConfirmed,
});

const ticketFor = ({ identifier, labelled }: { identifier: string; labelled: boolean }): TrackerTicket => ({
	id: `id-${identifier.toLowerCase()}`,
	identifier,
	title: `Hold ${identifier}`,
	url: `https://linear.app/lightsout/issue/${identifier}`,
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: labelled ? ['queue-parked', 'queue-blocked-gate-timed-out'] : ['queue-parked'],
	status: 'In Progress',
	finished: false,
	unfinishedBlockers: [],
});

interface PlantedHold {
	/** The ticket, spelled the way the tracker spells it — the hold's own file is named lowercased. */
	identifier: string;
	/** Whether the recorded hold says the tracker write has already landed. */
	labelConfirmed: boolean;
	/** Whether the tracker still shows the blocked label on that ticket. */
	labelled: boolean;
	/** Make the re-attempted label write for this ticket answer a failure. */
	writeFails?: boolean;
	/**
	 * Plant an extra key beside the recorded fields. The schema drops unknown keys
	 * on parse, so a file that still carries it is a file nothing rewrote.
	 */
	marked?: boolean;
	/** Record the hold but let the tracker return no ticket for it — a deleted or renamed one. */
	unknownToTracker?: boolean;
}

/**
 * A shared folder holding whichever records a case needs, and a tracker that
 * answers only for the identifiers it was asked about.
 *
 * The temp folder belongs to no repository, so the shared state folder resolves
 * to the run's own `.lightsout` — which is what lets the planted files and the
 * files the reconcile leaves behind be compared directly.
 */
const setupSync = ({ planted = [], readFailure }: { planted?: PlantedHold[]; readFailure?: string } = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-gate-holds-'));
	const dir = join(cwd, '.lightsout', 'gate-holds');
	const progress: string[] = [];
	const tickets: TrackerTicket[] = [];
	const refusing = new Set<string>();
	const plantedBytes: Record<string, string> = {};

	if (planted.length > 0) {
		mkdirSync(dir, { recursive: true });
	}

	for (const entry of planted) {
		const key = entry.identifier.toLowerCase();
		const hold = holdFor({ identifier: entry.identifier, labelConfirmed: entry.labelConfirmed });
		const bytes = JSON.stringify(entry.marked === true ? { ...hold, plantedMarker: 'nothing rewrote this file' } : hold);

		writeFileSync(join(dir, `${key}.json`), bytes, 'utf8');
		plantedBytes[key] = bytes;

		if (entry.unknownToTracker !== true) {
			tickets.push(ticketFor({ identifier: entry.identifier, labelled: entry.labelled }));
		}

		if (entry.writeFails === true) {
			refusing.add(`id-${key}`);
		}
	}

	mockGetTicketsByIdentifiers.mockImplementation(async ({ identifiers }) => {
		if (readFailure !== undefined) {
			return { error: readFailure };
		}

		const wanted = new Set(identifiers.map((one) => one.toLowerCase()));

		return tickets.filter((one) => wanted.has(one.identifier.toLowerCase()));
	});
	mockSetTicketLabel.mockImplementation(async ({ ticketId }) => (refusing.has(ticketId) ? { error: refusal } : undefined));

	return {
		cwd,
		plantedBytes,
		onProgress: (message: string) => {
			progress.push(message);
		},
		/** Every progress line as one blob, for a loose check that a failure was named. */
		reported: () => progress.join('\n'),
		heldOnDisk: ({ identifier }: { identifier: string }) => existsSync(join(dir, `${identifier.toLowerCase()}.json`)),
		bytesOnDisk: ({ identifier }: { identifier: string }) => readFileSync(join(dir, `${identifier.toLowerCase()}.json`), 'utf8'),
		confirmedOnDisk: ({ identifier }: { identifier: string }) =>
			(JSON.parse(readFileSync(join(dir, `${identifier.toLowerCase()}.json`), 'utf8')) as GateHold).labelConfirmed,
	};
};

describe('syncGateHolds', () => {
	test('clears a confirmed hold whose label a human removed', async () => {
		const { cwd, onProgress, heldOnDisk } = setupSync({ planted: [{ identifier: 'LO-70', labelConfirmed: true, labelled: false }] });

		const holds = await syncGateHolds({ cwd, settings, onProgress });

		// the label was written, so its absence is a human releasing the ticket —
		// the one thing that lets the next drain pick this ticket up again
		expect({ held: Object.keys(holds), onDisk: heldOnDisk({ identifier: 'LO-70' }) }).toStrictEqual({ held: [], onDisk: false });
	});

	test('keeps a confirmed hold whose label is still on the ticket', async () => {
		const { cwd, onProgress, heldOnDisk } = setupSync({ planted: [{ identifier: 'LO-70', labelConfirmed: true, labelled: true }] });

		const holds = await syncGateHolds({ cwd, settings, onProgress });

		// the hold is keyed lowercased even though the tracker spells the ticket in
		// caps, because every reader of this map compares that way
		expect({ holds, onDisk: heldOnDisk({ identifier: 'LO-70' }) }).toStrictEqual({
			holds: { 'lo-70': holdFor({ identifier: 'LO-70', labelConfirmed: true }) },
			onDisk: true,
		});
	});

	test('re-attempts an unconfirmed write and blocks either way', async () => {
		const { cwd, onProgress, reported, confirmedOnDisk } = setupSync({
			planted: [
				{ identifier: 'LO-70', labelConfirmed: false, labelled: false },
				{ identifier: 'LO-71', labelConfirmed: false, labelled: false, writeFails: true },
			],
		});

		const holds = await syncGateHolds({ cwd, settings, onProgress });

		// neither ticket shows the label, and neither is released by that: the write
		// never landed, so the missing label is no evidence at all. The one whose
		// re-attempt lands becomes confirmed; the one that is refused keeps blocking
		// and the refusal is said out loud rather than swallowed
		expect({
			held: Object.keys(holds).sort(),
			landed: holds['lo-70']?.labelConfirmed,
			landedOnDisk: confirmedOnDisk({ identifier: 'LO-70' }),
			refused: holds['lo-71']?.labelConfirmed,
			refusedOnDisk: confirmedOnDisk({ identifier: 'LO-71' }),
			named: reported().includes(refusal),
		}).toStrictEqual({
			held: ['lo-70', 'lo-71'],
			landed: true,
			landedOnDisk: true,
			refused: false,
			refusedOnDisk: false,
			named: true,
		});
	});

	test('keeps every hold when the tracker read fails', async () => {
		const { cwd, onProgress, reported, heldOnDisk } = setupSync({
			planted: [
				{ identifier: 'LO-70', labelConfirmed: true, labelled: true },
				{ identifier: 'LO-71', labelConfirmed: false, labelled: false },
			],
			readFailure: 'Linear answered 503',
		});

		const holds = await syncGateHolds({ cwd, settings, onProgress });

		// reading a failed lookup as release would drop every hold on the machine
		// during an outage, releasing tickets no human released
		expect({
			held: Object.keys(holds).sort(),
			confirmedStillOnDisk: heldOnDisk({ identifier: 'LO-70' }),
			unconfirmedStillOnDisk: heldOnDisk({ identifier: 'LO-71' }),
			named: reported().includes('Linear answered 503'),
			labelWrites: mockSetTicketLabel.mock.calls.length,
		}).toStrictEqual({
			held: ['lo-70', 'lo-71'],
			confirmedStillOnDisk: true,
			unconfirmedStillOnDisk: true,
			named: true,
			labelWrites: 0,
		});
	});

	test('keeps a confirmed hold the tracker returns no ticket for', async () => {
		const { cwd, onProgress, reported, heldOnDisk } = setupSync({
			planted: [{ identifier: 'LO-70', labelConfirmed: true, labelled: true, unknownToTracker: true }],
		});

		const holds = await syncGateHolds({ cwd, settings, onProgress });

		// a deleted or renamed ticket is unknown, not released: clearing it would put
		// the ticket straight back into the next drain with nobody having looked at it
		expect({
			holds,
			onDisk: heldOnDisk({ identifier: 'LO-70' }),
			named: reported().includes('lo-70 · '),
		}).toStrictEqual({
			holds: { 'lo-70': holdFor({ identifier: 'LO-70', labelConfirmed: true }) },
			onDisk: true,
			named: true,
		});
	});

	test('reads no tracker when nothing is held', async () => {
		const { cwd, onProgress } = setupSync();

		const holds = await syncGateHolds({ cwd, settings, onProgress });

		// a repository that has never timed out pays no network round trip here,
		// which is what keeps a drain behaving exactly as it does today
		expect({ holds, trackerReads: mockGetTicketsByIdentifiers.mock.calls.length }).toStrictEqual({ holds: {}, trackerReads: 0 });
	});

	test('writes back only the holds it changed', async () => {
		const { cwd, onProgress, plantedBytes, heldOnDisk, bytesOnDisk, confirmedOnDisk } = setupSync({
			planted: [
				{ identifier: 'LO-70', labelConfirmed: true, labelled: false },
				{ identifier: 'LO-71', labelConfirmed: false, labelled: false },
				{ identifier: 'LO-72', labelConfirmed: true, labelled: true, marked: true },
			],
		});

		const holds = await syncGateHolds({ cwd, settings, onProgress });

		// LO-72 is neither cleared nor newly confirmed, so its file is left byte for
		// byte as it was found — the planted marker a rewrite would drop is still
		// there. That is what stops a reconcile from overwriting a hold another
		// worker recorded in the same moment
		expect({
			held: Object.keys(holds).sort(),
			cleared: heldOnDisk({ identifier: 'LO-70' }),
			rewritten: confirmedOnDisk({ identifier: 'LO-71' }),
			untouched: bytesOnDisk({ identifier: 'LO-72' }),
		}).toStrictEqual({
			held: ['lo-71', 'lo-72'],
			cleared: false,
			rewritten: true,
			untouched: plantedBytes['lo-72'],
		});
	});
});
