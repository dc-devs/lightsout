import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { ticketAdoptCommand } from '#src/cli/ticket/ticketAdoptCommand.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Adoption itself is another module's entry point: what this file owns is which
// flags reach it, what the command prints, and how it ends. The subject is
// imported from its own file rather than the folder's barrel — the test sits
// inside the module, and the barrel would load every sibling subcommand against
// a ticket module that is mocked down to one export.
interface AdoptParams {
	cwd: string;
	ticketBranch: string;
	slug: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type AdoptResult = { address: string; record: TicketRecord; notice?: string; publishError?: string } | { error: string };

const mockAdoptTicketPlan = jest.fn<(params: AdoptParams) => Promise<AdoptResult>>();

jest.mock('#src/ticket/index.ts', () => ({ adoptTicketPlan: (params: AdoptParams) => mockAdoptTicketPlan(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A ticket whose only plan is the one adoption just made out of the legacy folder. */
const adoptedRecord: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'single-plan',
	plans: [{ id: '001-search', title: 'search', progress: 'ready', createdAt: '2026-09-12T00:00:00.000Z' }],
	history: [{ at: '2026-09-12T00:00:00.000Z', kind: 'plan-adopted', detail: 'adopted the legacy plan folder as plan 001-search' }],
};

const setupAdopt = ({ args, result = { address: 'lo-140-x/001-search', record: adoptedRecord } }: { args: string[]; result?: AdoptResult }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-adopt-command-'));

	mockAdoptTicketPlan.mockResolvedValue(result);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('ticketAdoptCommand', () => {
	test('adopts with the given slug and prints the plan address last', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupAdopt({ args: ['--name', 'lo-140-x', '--slug', 'search'] });

		await expect(ticketAdoptCommand(context)).rejects.toThrow(/process\.exit/);

		// the slug names plan 001's folder for the rest of the ticket's life, so it
		// must reach the operation exactly as it was typed
		expect(mockAdoptTicketPlan.mock.calls[0]?.[0]).toMatchObject({ cwd, ticketBranch: 'lo-140-x', slug: 'search' });
		// the address is the one thing a calling skill reads back, so it is the last
		// line on stdout whatever else the command printed above it
		expect(logged.at(-1)).toContain('lo-140-x/001-search');
		// the line above it says how far the adopted folder got — a plan that is
		// only ready to implement must not read as one already implemented
		expect(logged.join('\n')).toContain('001-search');
		expect(logged.join('\n')).toContain('ready to implement');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);

		const missingSlug = setupAdopt({ args: ['--name', 'lo-140-x'] });

		await expect(ticketAdoptCommand(missingSlug.context)).rejects.toThrow(/process\.exit/);

		// a missing slug is a usage error: nothing is adopted, so the operation is
		// never reached
		expect(mockAdoptTicketPlan).toHaveBeenCalledTimes(1);
		expect(missingSlug.logged).toStrictEqual([]);
		expect(missingSlug.errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(missingSlug.exitCodes).toStrictEqual([1]);
	});

	test('still names plan 001 when the answered record carries no plan entry', async () => {
		const { context, logged, exitCodes } = setupAdopt({
			args: ['--name', 'lo-140-x', '--slug', 'search'],
			result: { address: 'lo-140-x/001-search', record: { ...adoptedRecord, plans: [] } },
		});

		await expect(ticketAdoptCommand(context)).rejects.toThrow(/process\.exit/);

		// the address is the command's answer whatever the record came back
		// holding, so the line above it falls back rather than printing 'undefined'
		expect(logged.join('\n')).toContain('001');
		expect(logged.join('\n')).not.toContain('undefined');
		expect(logged.at(-1)).toContain('lo-140-x/001-search');
		expect(exitCodes).toStrictEqual([0]);
	});
});
