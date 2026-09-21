import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { ticketShowCommand } from '#src/cli/ticket/ticketShowCommand.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Reading the record — and pulling a newer published copy before showing it —
// is the ticket module's job: all this file owns is what the command prints
// from the record it is handed and how it ends. The subject is imported from
// its own file rather than the folder's barrel, because the barrel would load
// every sibling subcommand against a ticket module mocked down to one export.
interface PullTicketRecordParams {
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type PullTicketRecordResult = { record: TicketRecord | undefined } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullTicketRecordParams) => Promise<PullTicketRecordResult>>();

jest.mock('#src/ticket/index.ts', () => ({ pullTicketRecord: (params: PullTicketRecordParams) => mockPullTicketRecord(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A ticket far enough along to show every line the command has: one plan implemented, one ready to implement, one excluded, and a pending ship request. */
const record: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'multiple-plan',
	plans: [
		{ id: '001-search-basics', title: 'Search basics', progress: 'implemented', createdAt: '2026-09-12T10:00:00.000Z' },
		{ id: '002-fix-search', title: 'Fix search', progress: 'ready', createdAt: '2026-09-12T11:00:00.000Z' },
		{
			id: '003-drop-cache',
			title: 'Drop cache',
			progress: 'planning',
			createdAt: '2026-09-12T12:00:00.000Z',
			exclusion: { at: '2026-09-12T13:00:00.000Z', reason: 'covered by the upstream cache work', implementationRemoved: false },
		},
	],
	shipRequest: { planIds: ['001-search-basics', '002-fix-search'], requestedAt: '2026-09-12T14:00:00.000Z' },
	history: [{ at: '2026-09-12T14:00:00.000Z', kind: 'ship-requested', detail: 'ship requested for plans 001-search-basics, 002-fix-search' }],
};

/** The same ticket while its plans are moving: one run still going, one that gave up, one not started. */
const inFlightRecord: TicketRecord = {
	...record,
	plans: [
		{ id: '001-search-basics', title: 'Search basics', progress: 'implementing', createdAt: '2026-09-12T10:00:00.000Z' },
		{ id: '002-fix-search', title: 'Fix search', progress: 'failed', createdAt: '2026-09-12T11:00:00.000Z' },
		{ id: '003-drop-cache', title: 'Drop cache', progress: 'planning', createdAt: '2026-09-12T12:00:00.000Z' },
	],
	shipRequest: undefined,
};

/** The ticket after it shipped: history, and nothing about it changes again. */
const shippedRecord: TicketRecord = {
	...record,
	plans: [{ id: '001-search-basics', title: 'Search basics', progress: 'implemented', createdAt: '2026-09-12T10:00:00.000Z' }],
	shipRequest: undefined,
	shipped: { at: '2026-09-12T15:00:00.000Z', planIds: ['001-search-basics'], mergeCommit: '9f1c2d3' },
};

const setupShow = ({ args = ['--name', 'lo-140-x'], outcome = { record } }: { args?: string[]; outcome?: PullTicketRecordResult } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-show-command-'));

	mockPullTicketRecord.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('ticketShowCommand', () => {
	test("prints the mode, every plan's progress and exclusion, and the pending ship request", async () => {
		const { context, cwd, logged, errors, exitCodes } = setupShow();

		await expect(ticketShowCommand(context)).rejects.toThrow(/process\.exit/);

		// the repo's own config and environment reach the read, so a newer copy
		// published on the ticket is pulled before anything is shown
		expect(mockPullTicketRecord.mock.calls[0]?.[0]).toMatchObject({
			cwd,
			ticketBranch: 'lo-140-x',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
		});
		expect(mockPullTicketRecord.mock.calls[0]?.[0]?.env).toBe(process.env);

		const output = logged.join('\n');
		const planLineOf = ({ id }: { id: string }) => logged.find((line) => line.includes(id)) ?? '';

		expect(output).toContain('multiple-plan');
		// every plan the ticket holds gets its own line, carrying the id a human
		// types back at the other subcommands and the title they recognise it by
		expect(planLineOf({ id: '001-search-basics' })).toContain('Search basics');
		expect(planLineOf({ id: '002-fix-search' })).toContain('Fix search');
		expect(planLineOf({ id: '003-drop-cache' })).toContain('Drop cache');
		// a plan whose implementation finished and one that is only ready to
		// implement must not read the same way
		expect(planLineOf({ id: '001-search-basics' })).toMatch(/implemented/i);
		expect(planLineOf({ id: '002-fix-search' })).toMatch(/ready to implement/i);
		expect(planLineOf({ id: '002-fix-search' })).not.toMatch(/implemented/i);
		expect(planLineOf({ id: '003-drop-cache' })).toContain('covered by the upstream cache work');
		// the request is what authorizes shipping, so both ids it names are shown
		expect(output).toMatch(/001-search-basics[\s\S]*002-fix-search/);
		// the wording constraint the whole feature is held to
		expect(output).not.toMatch(/unfinished/i);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('keeps a plan whose implementation has not finished apart from one that failed, and calls neither unfinished', async () => {
		const { context, logged, exitCodes } = setupShow({ outcome: { record: inFlightRecord } });

		await expect(ticketShowCommand(context)).rejects.toThrow(/process\.exit/);

		const planLineOf = ({ id }: { id: string }) => logged.find((line) => line.includes(id)) ?? '';

		// a run still going and a run that gave up are different answers to 'can I
		// ship this', so they must not read the same
		expect(planLineOf({ id: '001-search-basics' })).toContain('its implementation has not finished');
		expect(planLineOf({ id: '002-fix-search' })).toContain('its implementation failed');
		expect(planLineOf({ id: '003-drop-cache' })).toContain('being planned');
		// the wording this whole feature is held to: a plan whose implementation
		// has not finished is never called an unfinished plan
		expect(logged.join('\n')).not.toMatch(/unfinished/i);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('names the merge commit once the ticket has shipped', async () => {
		const { context, logged, errors, exitCodes } = setupShow({ outcome: { record: shippedRecord } });

		await expect(ticketShowCommand(context)).rejects.toThrow(/process\.exit/);

		// a shipped ticket's record never changes again, so the commit it shipped
		// as is the line that tells a reader why every other subcommand refuses
		expect(logged.join('\n')).toContain('9f1c2d3');
		// with nothing left to approve, the ship-request line says so rather than
		// naming a request that was consumed
		expect(logged.join('\n')).toContain('no ship request is pending');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("reports the pull's own error rather than showing a record", async () => {
		const { context, logged, errors, exitCodes } = setupShow({
			outcome: { error: 'the record on LO-140 and the one here have both changed — settle it with `lightsout ticket sync --name lo-140-x`' },
		});

		await expect(ticketShowCommand(context)).rejects.toThrow(/process\.exit/);

		// showing a stale record as the truth is worse than showing nothing: the
		// divergence the pull found is passed straight through
		expect(logged).toStrictEqual([]);
		expect(errors.join('\n')).toContain('lightsout ticket sync --name lo-140-x');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses a ticket with no record and names only ticket add-plan', async () => {
		const { context, logged, errors, exitCodes } = setupShow({ outcome: { record: undefined } });

		await expect(ticketShowCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		// a folder with no record is either a ticket nobody has started or one
		// whose plans folder already holds loose files, and one command starts a
		// plan either way — the second form naming the folder those files are in
		expect(errors.join('\n')).toContain('ticket add-plan');
		expect(errors.join('\n')).toContain('--from');
		// the refusal must never name a word the dispatcher now rejects
		expect(errors.join('\n')).not.toMatch(/adopt/i);
		expect(exitCodes).toStrictEqual([1]);
	});
});
