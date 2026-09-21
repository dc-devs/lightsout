import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { workOrderSyncCommand } from '#src/cli/workOrder/workOrderSyncCommand.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Pulling, publishing and resolving a divergence belong to the ticket module:
// what this file owns is which kept copy reaches that operation, whether an
// unknown word ever reaches it at all, and how the command ends. The subject is
// imported from its own file rather than the folder's barrel — the test sits
// inside the module, and the barrel would load every sibling subcommand against
// a ticket module mocked down to one export. The mocked barrel also answers the
// two keep words, because the handler parses `--keep` against them.
interface SyncTicketRecordParams {
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	/** Which copy the human chose; absent asks for the ordinary pull-and-catch-up. */
	keep: 'local' | 'published' | undefined;
	onProgress?: (message: string) => void;
}

type SyncTicketRecordResult = { record: TicketRecord } | { error: string };

const mockSyncTicketRecord = jest.fn<(params: SyncTicketRecordParams) => Promise<SyncTicketRecordResult>>();

jest.mock('#src/ticket/index.ts', () => ({
	syncTicketRecord: (params: SyncTicketRecordParams) => mockSyncTicketRecord(params),
	TicketSyncKeep: { Local: 'local', Published: 'published' },
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** The record the sync settles on: one plan implemented, one ready to implement. */
const syncedRecord: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'multiple-plan',
	plans: [
		{ id: '001-search', title: 'Search', progress: 'implemented', createdAt: '2026-09-12T10:00:00.000Z' },
		{ id: '002-fix', title: 'Fix', progress: 'ready', createdAt: '2026-09-12T11:00:00.000Z' },
	],
	history: [{ at: '2026-09-12T11:00:00.000Z', kind: 'plan-added', detail: 'plan 002-fix added' }],
};

const setupSync = ({ args, outcome = { record: syncedRecord } }: { args: string[]; outcome?: SyncTicketRecordResult }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-sync-command-'));

	mockSyncTicketRecord.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('workOrderSyncCommand', () => {
	test('passes the kept copy to syncTicketRecord, or none', async () => {
		const kept = setupSync({ args: ['--name', 'lo-140-x', '--keep', 'published'] });

		await expect(workOrderSyncCommand(kept.context)).rejects.toThrow(/process\.exit/);

		// the chosen copy reaches the operation as the word the human typed, and
		// the repo's own config goes with it — without the tracker block there is
		// no published copy to keep
		expect(mockSyncTicketRecord.mock.calls[0]?.[0]).toMatchObject({
			cwd: kept.cwd,
			ticketBranch: 'lo-140-x',
			keep: 'published',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
		});
		// the process environment is handed over rather than read inside the
		// operation, which keeps the API key out of a second reader
		expect(mockSyncTicketRecord.mock.calls[0]?.[0]?.env).toBe(process.env);
		// keeping one copy sets the other aside, so the line says which one won
		// rather than reporting a plain catch-up
		expect(kept.logged.join('\n')).toContain('published');
		expect(kept.errors).toStrictEqual([]);
		expect(kept.exitCodes).toStrictEqual([0]);

		const plain = setupSync({ args: ['--name', 'lo-140-x'] });

		await expect(workOrderSyncCommand(plain.context)).rejects.toThrow(/process\.exit/);

		// no --keep is the ordinary sync: the operation must be told nothing was
		// chosen rather than being handed a default, because keeping a copy
		// overwrites work on the other side
		expect(mockSyncTicketRecord.mock.calls[1]?.[0]?.keep).toBeUndefined();
		expect(mockSyncTicketRecord.mock.calls[1]?.[0]).toMatchObject({ cwd: plain.cwd, ticketBranch: 'lo-140-x' });
		// nothing was set aside here, so the line reports the two copies agreeing
		expect(plain.logged.join('\n')).toContain('in sync');
		expect(plain.errors).toStrictEqual([]);
		expect(plain.exitCodes).toStrictEqual([0]);
	});

	test("reports the sync's own error and says nothing is in sync", async () => {
		const { context, logged, errors, exitCodes } = setupSync({
			args: ['--name', 'lo-140-x'],
			outcome: { error: 'the record on LO-140 and the one here have both changed — settle it with --keep local or --keep published' },
		});

		await expect(workOrderSyncCommand(context)).rejects.toThrow(/process\.exit/);

		// a divergence is the whole reason this subcommand exists: reporting it as
		// a sync that worked would hide the copy that is about to be overwritten
		expect(logged).toStrictEqual([]);
		expect(errors.join('\n')).toContain('--keep local');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses an unknown --keep value and names both copies', async () => {
		const { context, logged, errors, exitCodes } = setupSync({ args: ['--name', 'lo-140-x', '--keep', 'mine'] });

		await expect(workOrderSyncCommand(context)).rejects.toThrow(/process\.exit/);

		// a word that names neither copy cannot be guessed at: the refusal says
		// which two copies there are, and the record is left untouched
		expect(errors.join('\n')).toContain('local');
		expect(errors.join('\n')).toContain('published');
		expect(mockSyncTicketRecord).not.toHaveBeenCalled();
		expect(logged).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses an unknown --keep value and passes a valid one through after the work-order rename', async () => {
		const refused = setupSync({ args: ['--name', 'lo-140-x', '--keep', 'mine'] });

		await expect(workOrderSyncCommand(refused.context)).rejects.toThrow(/process\.exit/);

		// the refusal names the two copies there are to keep, reaches no sync, and
		// — the point of this phase — spells no `lightsout ticket` command at a
		// command word that no longer exists
		expect(refused.errors.join('\n')).toContain('local');
		expect(refused.errors.join('\n')).toContain('published');
		expect(refused.errors.join('\n')).not.toMatch(/lightsout ticket\s/);
		expect(mockSyncTicketRecord).not.toHaveBeenCalled();
		expect(refused.logged).toStrictEqual([]);
		expect(refused.exitCodes).toStrictEqual([1]);

		const kept = setupSync({ args: ['--name', 'lo-140-x', '--keep', 'local'] });

		await expect(workOrderSyncCommand(kept.context)).rejects.toThrow(/process\.exit/);

		// a word that does name a copy is carried through untranslated, so the
		// operation is told which side wins
		expect(mockSyncTicketRecord.mock.calls[0]?.[0]).toMatchObject({ cwd: kept.cwd, ticketBranch: 'lo-140-x', keep: 'local' });
		expect(kept.logged.join('\n')).toContain('local');
		expect(kept.logged.join('\n')).not.toMatch(/lightsout ticket\s/);
		expect(kept.exitCodes).toStrictEqual([0]);

		const plain = setupSync({ args: ['--name', 'lo-140-x'] });

		await expect(workOrderSyncCommand(plain.context)).rejects.toThrow(/process\.exit/);

		// no --keep at all is the ordinary catch-up, and its success line reports
		// the two copies agreeing without naming the old command word
		expect(mockSyncTicketRecord.mock.calls[1]?.[0]?.keep).toBeUndefined();
		expect(plain.logged.join('\n')).toContain('in sync');
		expect(plain.logged.join('\n')).not.toMatch(/lightsout ticket\s/);
		expect(plain.errors).toStrictEqual([]);
		expect(plain.exitCodes).toStrictEqual([0]);
	});
});
