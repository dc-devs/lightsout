import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { findBareTicketFolderRefusal } from '#src/ticket/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A record the contract accepts, written by hand so the refusal rule is the only thing under test. */
const ticketRecordOf = ({ branch }: { branch: string }) => ({
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch,
	mode: 'multiple-plan',
	plans: [
		{
			id: '001-search-basics',
			title: 'Search basics',
			progress: 'ready',
			createdAt: '2026-01-01T00:00:00.000Z',
		},
	],
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: 'plan-added', detail: 'added plan 001-search-basics' }],
});

/**
 * A checkout with no repository above it, so the shared state folder is its
 * own: one ticket folder holding a record, and one holding plan files alone
 * the way every folder did before ticket records existed.
 */
const setupCheckout = ({ withRecord, legacy }: { withRecord: string; legacy: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-bare-ticket-folder-'));
	const recordFolder = join(cwd, '.lightsout', 'plans', withRecord);

	mkdirSync(recordFolder, { recursive: true });
	writeFileSync(join(recordFolder, 'ticket.json'), JSON.stringify(ticketRecordOf({ branch: withRecord })));
	mkdirSync(join(cwd, '.lightsout', 'plans', legacy), { recursive: true });

	return { cwd };
};

/**
 * A checkout whose ticket folder holds a `ticket.json` the store cannot read as
 * that folder's record, so the answer has to be the read's own sentence rather
 * than the silence that would send the name down the legacy route.
 */
const setupBrokenRecord = ({ ticketBranch, contents }: { ticketBranch: string; contents: string }) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-bare-ticket-folder-'));
	const recordFolder = join(cwd, '.lightsout', 'plans', ticketBranch);

	mkdirSync(recordFolder, { recursive: true });
	writeFileSync(join(recordFolder, 'ticket.json'), contents);

	return { cwd };
};

/**
 * A primary checkout with a linked worktree added from it. The primary holds
 * the ticket record; the worktree holds only plan files under the same folder
 * name, which is what a run standing in a worktree sees of its own `.lightsout`
 * — so this is the shape that says which checkout decides the rule.
 */
const setupLinkedWorktree = ({ withRecord, legacy }: { withRecord: string; legacy: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', withRecord);
	const recordFolder = join(cwd, '.lightsout', 'plans', withRecord);

	execSync(`git worktree add -q -b ${withRecord} "${worktree}" main`, { cwd, stdio: 'ignore' });
	mkdirSync(recordFolder, { recursive: true });
	writeFileSync(join(recordFolder, 'ticket.json'), JSON.stringify(ticketRecordOf({ branch: withRecord })));
	mkdirSync(join(worktree, '.lightsout', 'plans', withRecord), { recursive: true });
	mkdirSync(join(worktree, '.lightsout', 'plans', legacy), { recursive: true });

	return { worktree };
};

describe('findBareTicketFolderRefusal', () => {
	test('findBareTicketFolderRefusal: refuses a bare name only when its ticket folder has a ticket record', async () => {
		const { cwd } = setupCheckout({ withRecord: 'lo-140-has-record', legacy: 'lo-141-legacy' });

		const planAddress = await findBareTicketFolderRefusal({ cwd, name: 'lo-140-has-record/001-search-basics' });
		const bareLegacyName = await findBareTicketFolderRefusal({ cwd, name: 'lo-141-legacy' });
		const bareNameWithRecord = await findBareTicketFolderRefusal({ cwd, name: 'lo-140-has-record' });

		expect({ planAddress, bareLegacyName, bareNameWithRecord }).toStrictEqual({
			planAddress: undefined,
			bareLegacyName: undefined,
			bareNameWithRecord: expect.stringContaining('lightsout ticket show --name lo-140-has-record'),
		});
		expect(bareNameWithRecord).toEqual(expect.stringContaining('lo-140-has-record/'));
	});

	test("findBareTicketFolderRefusal: asked from a linked worktree, answers from the primary checkout's record", async () => {
		const { worktree } = setupLinkedWorktree({ withRecord: 'lo-140-has-record', legacy: 'lo-141-legacy' });

		const bareNameWithRecord = await findBareTicketFolderRefusal({ cwd: worktree, name: 'lo-140-has-record' });
		const bareLegacyName = await findBareTicketFolderRefusal({ cwd: worktree, name: 'lo-141-legacy' });

		expect({ bareNameWithRecord, bareLegacyName }).toStrictEqual({
			bareNameWithRecord: expect.stringContaining('lightsout ticket show --name lo-140-has-record'),
			bareLegacyName: undefined,
		});
	});

	test.each([
		{ flaw: 'is not valid JSON', contents: '{ not json at all', expected: 'is not valid JSON' },
		{
			flaw: 'does not match the ticket record contract',
			contents: JSON.stringify({ schemaVersion: 1 }),
			expected: 'does not match the ticket record contract',
		},
		{
			flaw: 'names another branch',
			contents: JSON.stringify(ticketRecordOf({ branch: 'lo-999-elsewhere' })),
			expected: "names branch 'lo-999-elsewhere'",
		},
	])('findBareTicketFolderRefusal: answers the read error when the ticket folder holds a ticket.json that $flaw', async ({ contents, expected }) => {
		const { cwd } = setupBrokenRecord({ ticketBranch: 'lo-140-broken-record', contents });

		const refusal = await findBareTicketFolderRefusal({ cwd, name: 'lo-140-broken-record' });

		expect(refusal).toEqual(expect.stringContaining(expected));
	});
});
