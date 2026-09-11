import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { takeGateHold } from '#src/gates/gateHolds/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';

// Mocked Imports
// -------------------------
// Which folder every worktree of one repository shares is resolved through git,
// which this unit does not own. Declaring it also lets each act keep its own
// temp folder, so two runs in one test cannot write over each other.
const mockResolveSharedStateDir = jest.fn<(params: { cwd: string }) => Promise<string>>();

jest.mock('#src/common/workspace/resolveSharedStateDir.ts', () => ({
	resolveSharedStateDir: (params: { cwd: string }) => mockResolveSharedStateDir(params),
}));
// -------------------------
// The tracker is the unowned boundary; the local record is not. `resolveTrackerSettings`
// stays real, because whether a repository has a tracker at all is one of the
// facts these cases turn on, and a stub of it would decide that for them.
const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockSetTicketLabel =
	jest.fn<(params: { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean }) => Promise<TrackerFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	resolveTrackerSettings: jest.requireActual<typeof import('#src/ticketTracker/index.ts')>('#src/ticketTracker/index.ts').resolveTrackerSettings,
	setTicketLabel: (params: { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean }) => mockSetTicketLabel(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** Named inline rather than through the shared block, whose `provider` widens to `string` and would need a cast here. */
const trackerBlock: LightsoutConfig['ticket-tracker'] = { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' };
const config: LightsoutConfig = { gates, 'ticket-tracker': trackerBlock };
const env = { LINEAR_API_KEY: 'lin_key' };

const runId = 'gates-run-9';
const worktreePath = '/repo/.worktrees/lo-118-gate-lock';
const reason = 'gates never started: this run waited 30m for another gate run on this machine to finish, and the machine is still taken.';

/** The ticket the branch carries — the tracker addresses it by `id`, which only a lookup turns the reference into. */
const ticket: TrackerTicket = {
	id: 'id-118',
	identifier: 'LO-118',
	title: 'Gate runs pile onto one machine',
	url: 'https://linear.app/lightsout/issue/LO-118',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: ['queue-parked'],
	status: 'In Progress',
	finished: false,
	unfinishedBlockers: [],
};

/** A hold another worker recorded for its own ticket a moment earlier. */
const otherWorkersHold = JSON.stringify({
	takenAt: '2026-01-01T00:00:00.000Z',
	runId: 'other-worker',
	worktreePath: '/repo/.worktrees/lo-77-other',
	reason: 'waited 30m for the machine',
	labelConfirmed: true,
});

/** One ticket's hold file, named by the lowercased reference — the layout every worktree reads. */
const holdPathOf = ({ holdsDir, identifier }: { holdsDir: string; identifier: string }): string => join(holdsDir, `${identifier.toLowerCase()}.json`);

/** The bytes on disk, or undefined where no hold has been recorded for that ticket. */
const readHold = ({ holdsDir, identifier }: { holdsDir: string; identifier: string }): string | undefined => {
	const path = holdPathOf({ holdsDir, identifier });

	return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

const parsedHold = ({ holdsDir, identifier }: { holdsDir: string; identifier: string }): unknown =>
	JSON.parse(readHold({ holdsDir, identifier }) ?? 'null') as unknown;

/** What one act varies: which repository it runs for, which environment carries the credential, and whether a ticket is named at all. */
interface TakeParams {
	config?: LightsoutConfig;
	env?: NodeJS.ProcessEnv;
	noTicket?: boolean;
}

interface SetupParams {
	/** What the tracker answers the label write with. A failure means the label never landed. */
	labelFailure?: TrackerFailure;
	/** Another worker's hold, already on disk before this one is taken. */
	otherHold?: { identifier: string; body: string };
	/**
	 * Resolve the shared folder underneath a plain file, so creating it fails the
	 * way an unwritable shared folder or a full disk does.
	 */
	unwritable?: boolean;
}

/**
 * A run whose gates never got the machine, about to record why against its own
 * ticket.
 *
 * The hold is written for real onto a temp folder rather than through a stubbed
 * writer: what these cases are about is what is on disk at two separate moments,
 * which a stub could only restate.
 */
const setupHold = ({ labelFailure, otherHold, unwritable = false }: SetupParams = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-gate-hold-'));
	const sharedRoot = unwritable ? join(cwd, 'a-file-not-a-folder') : cwd;
	const holdsDir = join(sharedRoot, '.lightsout', 'gate-holds');
	const progress: string[] = [];
	/** What the hold file said at the instant the tracker was asked for the label. */
	const atLabelWrite: (string | undefined)[] = [];

	if (unwritable) {
		writeFileSync(join(cwd, 'a-file-not-a-folder'), 'not a directory', 'utf8');
	}

	mockResolveSharedStateDir.mockImplementation(async () => join(sharedRoot, '.lightsout'));
	mockGetTicketsByIdentifiers.mockResolvedValue([ticket]);
	mockSetTicketLabel.mockImplementation(async () => {
		atLabelWrite.push(readHold({ holdsDir, identifier: 'LO-118' }));

		return labelFailure;
	});

	if (otherHold !== undefined) {
		mkdirSync(holdsDir, { recursive: true });
		writeFileSync(holdPathOf({ holdsDir, identifier: otherHold.identifier }), otherHold.body, 'utf8');
	}

	return {
		holdsDir,
		atLabelWrite,
		progress,
		take: ({ config: given = config, env: givenEnv = env, noTicket = false }: TakeParams = {}) =>
			takeGateHold({
				cwd,
				config: given,
				env: givenEnv,
				ticketRef: noTicket ? undefined : 'LO-118',
				runId,
				worktreePath,
				reason,
				onProgress: (message: string) => progress.push(message),
			}),
	};
};

describe('takeGateHold', () => {
	test('records the hold locally before the tracker write and confirms it after', async () => {
		const { holdsDir, atLabelWrite, take } = setupHold();

		const failure = await take();

		expect(failure).toBeUndefined();
		// the local record is what refuses the next run, so it has to be on disk —
		// and unconfirmed — before the tracker is ever asked: a process killed
		// between the two still leaves a hold nothing walks past, which is the whole
		// reason the order is fixed rather than convenient
		expect({
			whenTheTrackerWasAsked: JSON.parse(atLabelWrite[0] ?? 'null') as unknown,
			afterTheWriteLanded: parsedHold({ holdsDir, identifier: 'LO-118' }),
		}).toEqual({
			whenTheTrackerWasAsked: expect.objectContaining({ labelConfirmed: false, runId, worktreePath, reason }),
			afterTheWriteLanded: expect.objectContaining({ labelConfirmed: true, runId, worktreePath, reason }),
		});
	});

	test("touches only its own ticket's hold file", async () => {
		const { holdsDir, take } = setupHold({ otherHold: { identifier: 'LO-77', body: otherWorkersHold } });

		await take();

		// two workers can time out in the same second. A writer that read the folder
		// and wrote it back would drop whichever hold it did not know about, and that
		// ticket would be picked up again by the next drain as though nothing held it
		expect({ other: readHold({ holdsDir, identifier: 'LO-77' }), files: readdirSync(holdsDir).sort() }).toStrictEqual({
			other: otherWorkersHold,
			files: ['lo-118.json', 'lo-77.json'],
		});
	});

	test('keeps an unconfirmed hold and names the tracker failure', async () => {
		const { holdsDir, take } = setupHold({ labelFailure: { error: 'Linear refused the label write: 403 forbidden' } });

		const failure = await take();

		// a label that never landed is not a hold that never happened: the record
		// stays unconfirmed, so no later reconcile can read the missing label as a
		// human releasing the ticket
		expect({ failure, hold: parsedHold({ holdsDir, identifier: 'LO-118' }) }).toEqual({
			failure: expect.stringContaining('403 forbidden'),
			hold: expect.objectContaining({ labelConfirmed: false, runId, worktreePath, reason }),
		});
	});

	test('records the hold unconfirmed when the tracker credential is missing', async () => {
		const { holdsDir, take } = setupHold();

		const failure = await take({ env: {} });

		// an absent `ticket-tracker` block and an unset credential are not the same
		// thing: this repository is fully tracker-backed, so letting it time out and
		// record nothing would hand the ticket straight back to the next drain
		expect({
			failure,
			hold: parsedHold({ holdsDir, identifier: 'LO-118' }),
			ticketReads: mockGetTicketsByIdentifiers.mock.calls.length,
			labelWrites: mockSetTicketLabel.mock.calls.length,
		}).toEqual({
			failure: expect.stringContaining('LINEAR_API_KEY'),
			hold: expect.objectContaining({ labelConfirmed: false, runId, worktreePath, reason }),
			ticketReads: 0,
			labelWrites: 0,
		});
	});

	test('names a local write it could not make and still asks the tracker', async () => {
		const { holdsDir, take, progress } = setupHold({ unwritable: true });

		const failure = await take();

		// a throw here would replace the coordination stop this whole run exists to
		// deliver, and in the ship lane a rejected promise would reach the lane
		// runner instead of a parked outcome. The label is still attempted, because
		// if it lands the ticket is refused on the label alone
		expect({
			failure,
			recorded: existsSync(holdsDir),
			labelWrites: mockSetTicketLabel.mock.calls.length,
			reported: progress.join('\n'),
		}).toEqual({
			failure: expect.stringContaining('could not be recorded on this machine'),
			recorded: false,
			labelWrites: 1,
			reported: expect.stringContaining('LO-118 · '),
		});
	});

	test('takes no hold without a tracker or a ticket', async () => {
		const { holdsDir, take } = setupHold();

		const withoutTracker = await take({ config: { gates } });
		const withoutTicket = await take({ noTicket: true });

		// there is no label to write and no refusal site that could ever read one, so
		// recording a hold here would leave a file only a human deleting it releases
		expect({
			withoutTracker,
			withoutTicket,
			recorded: existsSync(holdsDir),
			ticketReads: mockGetTicketsByIdentifiers.mock.calls.length,
			labelWrites: mockSetTicketLabel.mock.calls.length,
		}).toStrictEqual({ withoutTracker: undefined, withoutTicket: undefined, recorded: false, ticketReads: 0, labelWrites: 0 });
	});
});
