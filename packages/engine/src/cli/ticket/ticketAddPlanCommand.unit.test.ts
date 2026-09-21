import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { ticketAddPlanCommand } from '#src/cli/ticket/ticketAddPlanCommand.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Adding the plan is the ticket module's job: all this file owns is what
// reaches that operation, what the command prints, and how it ends. The subject
// is imported from its own file rather than the folder's barrel, because the
// barrel would load every sibling subcommand against a ticket module mocked
// down to one export.
interface AddTicketPlanParams {
	cwd: string;
	ticketBranch: string;
	slug: string;
	title?: string;
	from?: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type AddTicketPlanResult = { address: string; record: TicketRecord; notice?: string; publishError?: string } | { error: string };

const mockAddTicketPlan = jest.fn<(params: AddTicketPlanParams) => Promise<AddTicketPlanResult>>();

jest.mock('#src/ticket/index.ts', () => ({ addTicketPlan: (params: AddTicketPlanParams) => mockAddTicketPlan(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

const record: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'multiple-plan',
	plans: [{ id: '003-fix', title: 'Fix', progress: 'planning', createdAt: '2026-09-12T10:00:00.000Z' }],
	history: [{ at: '2026-09-12T10:00:00.000Z', kind: 'plan-added', detail: 'plan 003-fix added' }],
};

const setupAddPlan = ({
	args = ['--name', 'lo-140-x', '--slug', 'fix', '--title', 'Fix'],
	outcome = { address: 'lo-140-x/003-fix', record },
}: {
	args?: string[];
	/** What the ticket operation answers: a plain added plan, by default. */
	outcome?: AddTicketPlanResult;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-add-plan-command-'));

	mockAddTicketPlan.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('ticketAddPlanCommand', () => {
	test('prints the plan address on the last line and exits 0', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupAddPlan({
			outcome: { address: 'lo-140-x/003-fix', record, notice: 'the pending ship request was withdrawn because plan 003-fix was added' },
		});

		await expect(ticketAddPlanCommand(context)).rejects.toThrow(/process\.exit/);

		// the repo's own config reaches the operation, tracker block and all —
		// without it the record change can resolve no tracker to publish to
		expect(mockAddTicketPlan.mock.calls[0]?.[0]).toMatchObject({
			cwd,
			ticketBranch: 'lo-140-x',
			slug: 'fix',
			title: 'Fix',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
			onProgress: expect.any(Function),
		});
		// the process environment is handed over rather than read inside the
		// operation, which is what keeps the API key out of a second reader
		expect(mockAddTicketPlan.mock.calls[0]?.[0]?.env).toBe(process.env);

		const noticeIndex = logged.findIndex((line) => line.includes('withdrawn'));

		// a skill reads the address off the last line, so the notice must land
		// before the command's own lines rather than after them
		expect(noticeIndex).toBeGreaterThanOrEqual(0);
		expect(noticeIndex).toBeLessThan(logged.length - 1);
		expect(logged.at(-1)).toContain('lo-140-x/003-fix');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('passes --from through as typed and says the plan was made from that folder above the address', async () => {
		const { context, logged, errors, exitCodes } = setupAddPlan({
			args: ['--name', 'lo-140-x', '--slug', 'fix', '--from', 'search-notes'],
			outcome: {
				address: 'lo-140-x/003-fix',
				record: { ...record, plans: [{ id: '003-fix', title: 'Fix', progress: 'ready', createdAt: '2026-09-12T10:00:00.000Z' }] },
			},
		});

		await expect(ticketAddPlanCommand(context)).rejects.toThrow(/process\.exit/);

		// --from names a folder's bare name under the plans directory, so it
		// reaches the operation exactly as it was typed rather than resolved here
		expect(mockAddTicketPlan.mock.calls[0]?.[0]).toMatchObject({ ticketBranch: 'lo-140-x', slug: 'fix', from: 'search-notes' });
		// the address is the one thing a calling skill reads back, so it stays the
		// last line for this form too
		expect(logged.at(-1)).toContain('lo-140-x/003-fix');
		// the line above it names the folder the files came from and how far the
		// plan already got — a --from add must not read like an empty plan
		expect(logged.at(-2) ?? '').toContain('search-notes');
		expect(logged.at(-2) ?? '').toContain('ready to implement');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);

		const withoutPlanEntry = setupAddPlan({
			args: ['--name', 'lo-140-x', '--slug', 'fix', '--from', 'search-notes'],
			outcome: { address: 'lo-140-x/003-fix', record: { ...record, plans: [] } },
		});

		await expect(ticketAddPlanCommand(withoutPlanEntry.context)).rejects.toThrow(/process\.exit/);

		// the address is the command's answer whatever the record came back
		// holding, so the line above it falls back rather than printing 'undefined'
		expect(withoutPlanEntry.logged.at(-1)).toContain('lo-140-x/003-fix');
		expect(withoutPlanEntry.logged.join('\n')).not.toContain('undefined');
		expect(withoutPlanEntry.logged.at(-2) ?? '').toContain('being planned');
		expect(withoutPlanEntry.exitCodes).toStrictEqual([0]);
	});

	test('prints the refusal and exits 1 when addTicketPlan refuses', async () => {
		const { context, logged, errors, exitCodes } = setupAddPlan({
			outcome: { error: 'lo-140-x is in single-plan mode and already holds plan 001 — run lightsout ticket mode --set multiple-plan first' },
		});

		await expect(ticketAddPlanCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors.join('\n')).toContain('lightsout ticket mode --set multiple-plan');
		expect(exitCodes).toStrictEqual([1]);
	});

	test('keeps the local change but exits 1 naming ticket sync when publishing the record fails', async () => {
		const { context, logged, errors, exitCodes } = setupAddPlan({
			outcome: { address: 'lo-140-x/003-fix', record, publishError: 'the tracker refused the attachment: 503 service unavailable' },
		});

		await expect(ticketAddPlanCommand(context)).rejects.toThrow(/process\.exit/);

		// the plan was added locally, so the address is still the command's answer;
		// only reaching the tracker failed, and that is what the retry is for
		expect(logged.at(-1)).toContain('lo-140-x/003-fix');
		expect(errors.join('\n')).toContain('503 service unavailable');
		expect(errors.join('\n')).toContain('lightsout ticket sync --name lo-140-x');
		expect(exitCodes).toStrictEqual([1]);
	});
});
