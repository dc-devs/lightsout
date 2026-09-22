import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { workOrderShowCommand } from '#src/cli/workOrder/workOrderShowCommand.ts';
import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
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

type PullTicketRecordResult = { record: WorkOrderState | undefined } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullTicketRecordParams) => Promise<PullTicketRecordResult>>();

jest.mock('#src/ticket/index.ts', () => ({ pullTicketRecord: (params: PullTicketRecordParams) => mockPullTicketRecord(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A work order far enough along to show every line the command has: one plan implemented, one ready to implement, one excluded, and a pending ship request. */
const record: WorkOrderState = {
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

/**
 * One plan at every progress value the record can hold, on a work order that
 * has shipped — so one run shows the whole progress vocabulary beside the
 * merge commit line.
 */
const everyProgressRecord: WorkOrderState = {
	...record,
	plans: [
		{ id: '001-search-basics', title: 'Search basics', progress: 'planning', createdAt: '2026-09-12T10:00:00.000Z' },
		{ id: '002-fix-search', title: 'Fix search', progress: 'ready', createdAt: '2026-09-12T11:00:00.000Z' },
		{ id: '003-drop-cache', title: 'Drop cache', progress: 'implementing', createdAt: '2026-09-12T12:00:00.000Z' },
		{ id: '004-warm-index', title: 'Warm index', progress: 'implemented', createdAt: '2026-09-12T13:00:00.000Z' },
		{ id: '005-purge-logs', title: 'Purge logs', progress: 'failed', createdAt: '2026-09-12T14:00:00.000Z' },
	],
	shipRequest: undefined,
	shipped: { at: '2026-09-12T15:00:00.000Z', planIds: ['004-warm-index'], mergeCommit: '9f1c2d3' },
};

const setupShow = ({ args = ['--name', 'lo-140-x'], outcome = { record } }: { args?: string[]; outcome?: PullTicketRecordResult } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-show-command-'));

	mockPullTicketRecord.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/** The one line that names a plan, so each plan's own wording can be read on its own. */
const planLineOf = ({ logged, id }: { logged: string[]; id: string }) => logged.find((line) => line.includes(id)) ?? '';

describe('workOrderShowCommand', () => {
	test("prints the mode, every plan's progress and exclusion, and the pending ship request", async () => {
		const { context, cwd, logged, errors, exitCodes } = setupShow();

		await expect(workOrderShowCommand(context)).rejects.toThrow(/process\.exit/);

		// the repo's own config and environment reach the read, so a newer copy
		// published on the tracker is pulled before anything is shown
		expect(mockPullTicketRecord.mock.calls[0]?.[0]).toMatchObject({
			cwd,
			ticketBranch: 'lo-140-x',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
		});
		expect(mockPullTicketRecord.mock.calls[0]?.[0]?.env).toBe(process.env);

		const output = logged.join('\n');

		expect(output).toContain('multiple-plan');
		// every plan the work order holds gets its own line, carrying the id a
		// human types back at the other subcommands and the title they know it by
		expect(planLineOf({ logged, id: '001-search-basics' })).toContain('Search basics');
		expect(planLineOf({ logged, id: '002-fix-search' })).toContain('Fix search');
		expect(planLineOf({ logged, id: '003-drop-cache' })).toContain('Drop cache');
		// a plan whose implementation finished and one that is only ready to
		// implement must not read the same way
		expect(planLineOf({ logged, id: '001-search-basics' })).toMatch(/implemented/i);
		expect(planLineOf({ logged, id: '002-fix-search' })).toMatch(/ready to implement/i);
		expect(planLineOf({ logged, id: '002-fix-search' })).not.toMatch(/implemented/i);
		expect(planLineOf({ logged, id: '003-drop-cache' })).toContain('covered by the upstream cache work');
		// the request is what authorizes shipping, so both ids it names are shown
		expect(output).toMatch(/001-search-basics[\s\S]*002-fix-search/);
		// the wording constraint the whole feature is held to
		expect(output).not.toMatch(/unfinished/i);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('prints one line per plan with its progress wording and names the merge commit after the work-order rename', async () => {
		const { context, logged, errors, exitCodes } = setupShow({ outcome: { record: everyProgressRecord } });

		await expect(workOrderShowCommand(context)).rejects.toThrow(/process\.exit/);

		const output = logged.join('\n');

		// one line per plan, and every progress value reads as its own answer to
		// 'can I ship this' — a run still going and a run that gave up most of all
		expect(planLineOf({ logged, id: '001-search-basics' })).toContain('being planned');
		expect(planLineOf({ logged, id: '002-fix-search' })).toContain('ready to implement');
		expect(planLineOf({ logged, id: '003-drop-cache' })).toContain('its implementation has not finished');
		expect(planLineOf({ logged, id: '004-warm-index' })).toMatch(/implemented/i);
		expect(planLineOf({ logged, id: '005-purge-logs' })).toContain('its implementation failed');
		// the wording this whole feature is held to: a plan whose implementation
		// has not finished is never called an unfinished plan
		expect(output).not.toMatch(/unfinished/i);
		// a shipped work order's record never changes again, so the commit it
		// shipped as is the line that tells a reader why everything else refuses
		expect(output).toContain('9f1c2d3');
		// with nothing left to approve, the ship-request line says so rather than
		// naming a request that was consumed
		expect(output).toContain('no ship request is pending');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test("reports the pull's own error rather than showing a record", async () => {
		const { context, logged, errors, exitCodes } = setupShow({
			outcome: { error: 'the record on LO-140 and the one here have both changed — settle it with `lightsout work-order sync --name lo-140-x`' },
		});

		await expect(workOrderShowCommand(context)).rejects.toThrow(/process\.exit/);

		// showing a stale record as the truth is worse than showing nothing: the
		// divergence the pull found is passed straight through
		expect(logged).toStrictEqual([]);
		expect(errors.join('\n')).toContain('lightsout work-order sync --name lo-140-x');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses a folder with no record naming only work-order add-plan', async () => {
		const { context, logged, errors, exitCodes } = setupShow({ outcome: { record: undefined } });

		await expect(workOrderShowCommand(context)).rejects.toThrow(/process\.exit/);

		const refusal = errors.join('\n');

		expect(logged).toStrictEqual([]);
		// a folder with no record is either work nobody has started or one whose
		// plans folder already holds loose files, and one command starts a plan
		// either way — the second form naming the folder those files are in
		expect(refusal).toContain('work-order add-plan');
		expect(refusal).toContain('lo-140-x');
		expect(refusal).toContain('<slug>');
		expect(refusal).toContain('--from');
		// and it names no second command: every command the sentence spells is
		// this one, so nothing sends a reader at the old command word
		expect(refusal.match(/lightsout [a-z-]+/g)).toStrictEqual(['lightsout work-order']);
		// the refusal must never name a word the dispatcher now rejects
		expect(refusal).not.toMatch(/adopt/i);
		expect(exitCodes).toStrictEqual([1]);
	});
});
