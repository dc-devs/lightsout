import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readTicketRecord } from '#src/ticket/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A record the contract accepts, written by hand so the reader is the only thing under test. */
const ticketRecordOf = ({ branch, ticketRef }: { branch: string; ticketRef: string }) => ({
	schemaVersion: 1,
	ticketRef,
	branch,
	mode: 'multiple-plan',
	plans: [
		{
			id: '001-ticket-record',
			title: 'The ticket record',
			progress: 'implemented',
			createdAt: '2026-01-01T00:00:00.000Z',
		},
	],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-ticket-record' }],
});

/** Writes a ticket folder's `ticket.json` under a checkout's plans folder, where the reader looks for it. */
const writeTicketFile = ({ cwd, ticketBranch, contents }: { cwd: string; ticketBranch: string; contents: string }) => {
	const ticketFolder = join(cwd, '.lightsout', 'plans', ticketBranch);

	mkdirSync(ticketFolder, { recursive: true });
	writeFileSync(join(ticketFolder, 'ticket.json'), contents);

	return join(ticketFolder, 'ticket.json');
};

/**
 * A checkout with no repository above it, so the shared state folder is its
 * own: ticket folders that exist with no record, and hand-written record files
 * for the cases the store would never produce.
 */
const setupCheckout = ({
	emptyFolders = [],
	records = {},
	unreadable = [],
}: {
	emptyFolders?: string[];
	records?: Record<string, string>;
	/** Ticket branches whose `ticket.json` is a directory, so reading it fails for a reason that is not its absence. */
	unreadable?: string[];
} = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-record-'));
	const recordPaths: Record<string, string> = {};

	for (const ticketBranch of emptyFolders) {
		mkdirSync(join(cwd, '.lightsout', 'plans', ticketBranch), { recursive: true });
	}

	for (const [ticketBranch, contents] of Object.entries(records)) {
		recordPaths[ticketBranch] = writeTicketFile({ cwd, ticketBranch, contents });
	}

	for (const ticketBranch of unreadable) {
		const recordPath = join(cwd, '.lightsout', 'plans', ticketBranch, 'ticket.json');

		mkdirSync(recordPath, { recursive: true });
		recordPaths[ticketBranch] = recordPath;
	}

	return { cwd, recordPaths };
};

/**
 * A primary checkout with a linked worktree added from it, each holding its own
 * plans folder — the shape that decides which copy of a ticket record a run in
 * a worktree reads.
 */
const setupLinkedWorktree = ({ ticketBranch }: { ticketBranch: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', ticketBranch);

	execSync(`git worktree add -q -b ${ticketBranch} "${worktree}" main`, { cwd, stdio: 'ignore' });

	writeTicketFile({
		cwd,
		ticketBranch,
		contents: JSON.stringify(ticketRecordOf({ branch: ticketBranch, ticketRef: 'LO-140' })),
	});
	writeTicketFile({
		cwd: worktree,
		ticketBranch,
		contents: JSON.stringify(ticketRecordOf({ branch: ticketBranch, ticketRef: 'LO-999' })),
	});

	return { worktree };
};

describe('readTicketRecord', () => {
	test('answers no record when the primary checkout holds no ticket.json', async () => {
		const { cwd } = setupCheckout({ emptyFolders: ['lo-140-folder-only'] });

		const missingFolder = await readTicketRecord({ cwd, ticketBranch: 'lo-140-no-folder' });
		const folderWithoutRecord = await readTicketRecord({ cwd, ticketBranch: 'lo-140-folder-only' });

		expect({ missingFolder, folderWithoutRecord }).toStrictEqual({
			missingFolder: { record: undefined },
			folderWithoutRecord: { record: undefined },
		});
	});

	test("reads the primary checkout's record when asked from a linked worktree", async () => {
		const { worktree } = setupLinkedWorktree({ ticketBranch: 'lo-140-multi' });

		const read = await readTicketRecord({ cwd: worktree, ticketBranch: 'lo-140-multi' });

		expect(read).toStrictEqual({ record: ticketRecordOf({ branch: 'lo-140-multi', ticketRef: 'LO-140' }) });
	});

	test('answers an error naming the file when the record cannot be read at all', async () => {
		const { cwd, recordPaths } = setupCheckout({ unreadable: ['lo-140-unreadable'] });

		const read = await readTicketRecord({ cwd, ticketBranch: 'lo-140-unreadable' });

		expect(read).toStrictEqual({ error: expect.stringContaining(recordPaths['lo-140-unreadable']) });
	});

	test('answers an error naming the file for a corrupt record or one naming another branch', async () => {
		const { cwd, recordPaths } = setupCheckout({
			records: {
				'lo-140-not-json': '{ this is not json',
				// Valid JSON the contract still refuses: a mode neither member of the
				// two the record declares, which is what a hand edit could leave.
				'lo-140-off-contract': JSON.stringify({
					...ticketRecordOf({ branch: 'lo-140-off-contract', ticketRef: 'LO-140' }),
					mode: 'multi',
				}),
				'lo-140-other-branch': JSON.stringify(ticketRecordOf({ branch: 'lo-140-somewhere-else', ticketRef: 'LO-141' })),
			},
		});

		const notJson = await readTicketRecord({ cwd, ticketBranch: 'lo-140-not-json' });
		const offContract = await readTicketRecord({ cwd, ticketBranch: 'lo-140-off-contract' });
		const otherBranch = await readTicketRecord({ cwd, ticketBranch: 'lo-140-other-branch' });

		expect({ notJson, offContract, otherBranch }).toStrictEqual({
			notJson: { error: expect.stringContaining(recordPaths['lo-140-not-json']) },
			offContract: { error: expect.stringContaining(recordPaths['lo-140-off-contract']) },
			otherBranch: { error: expect.stringContaining(recordPaths['lo-140-other-branch']) },
		});
	});
});
