import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { workOrderRequestShipCommand } from '#src/cli/workOrder/workOrderRequestShipCommand.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Recording and withdrawing a ship request are the ticket module's operations:
// what this file owns is which of the two a set of flags reaches, with what, and
// how the command ends when the flags name neither or both. The subject is
// imported from its own file rather than the folder's barrel, because the barrel
// would load every sibling subcommand against a ticket module mocked down to two
// exports.
interface RequestParams {
	cwd: string;
	ticketBranch: string;
	plans: string[];
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

interface WithdrawParams {
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type ChangeResult = { record: TicketRecord; notice?: string; publishError?: string } | { error: string };

const mockRequestTicketShip = jest.fn<(params: RequestParams) => Promise<ChangeResult>>();
const mockWithdrawTicketShipRequest = jest.fn<(params: WithdrawParams) => Promise<ChangeResult>>();

jest.mock('#src/ticket/index.ts', () => ({
	requestTicketShip: (params: RequestParams) => mockRequestTicketShip(params),
	withdrawTicketShipRequest: (params: WithdrawParams) => mockWithdrawTicketShipRequest(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A work order whose two plans are exactly the set a ship request must name. */
const record: TicketRecord = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'multiple-plan',
	plans: [
		{ id: '001-search', title: 'search', progress: 'implemented', createdAt: '2026-09-12T10:00:00.000Z' },
		{ id: '002-fix', title: 'fix', progress: 'ready', createdAt: '2026-09-12T11:00:00.000Z' },
	],
	history: [{ at: '2026-09-12T11:00:00.000Z', kind: 'plan-added', detail: 'plan 002-fix added' }],
};

/** The same work order once the request is on its record, bound to both plans. */
const requestedRecord: TicketRecord = {
	...record,
	shipRequest: { planIds: ['001-search', '002-fix'], requestedAt: '2026-09-12T12:00:00.000Z' },
};

const setupRequestShip = ({ args, result = { record } }: { args: string[]; result?: ChangeResult }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-request-ship-command-'));

	mockRequestTicketShip.mockResolvedValue(result);
	mockWithdrawTicketShipRequest.mockResolvedValue(result);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('workOrderRequestShipCommand', () => {
	test('requests with --plans and withdraws with --withdraw', async () => {
		const requesting = setupRequestShip({ args: ['--name', 'lo-140-x', '--plans', '1,002-fix'] });

		await expect(workOrderRequestShipCommand(requesting.context)).rejects.toThrow(/process\.exit/);

		// the tokens reach the operation exactly as typed — a bare number and a
		// full id are both accepted there, and it is the operation that resolves
		// them against the work order's plans
		expect(mockRequestTicketShip.mock.calls[0]?.[0]).toMatchObject({
			cwd: requesting.cwd,
			ticketBranch: 'lo-140-x',
			plans: ['1', '002-fix'],
		});
		expect(mockWithdrawTicketShipRequest).not.toHaveBeenCalled();
		expect(requesting.exitCodes).toStrictEqual([0]);

		const withdrawing = setupRequestShip({ args: ['--name', 'lo-140-x', '--withdraw'] });

		await expect(workOrderRequestShipCommand(withdrawing.context)).rejects.toThrow(/process\.exit/);

		// --withdraw takes the other operation, and never reaches the one that
		// would store a request
		expect(mockWithdrawTicketShipRequest.mock.calls[0]?.[0]).toMatchObject({ cwd: withdrawing.cwd, ticketBranch: 'lo-140-x' });
		expect(mockRequestTicketShip).toHaveBeenCalledTimes(1);
		expect(withdrawing.exitCodes).toStrictEqual([0]);
	});

	test('names the plans a recorded request binds the work order to, and says a withdrawn one leaves it open', async () => {
		const requested = setupRequestShip({ args: ['--name', 'lo-140-x', '--plans', '1,2'], result: { record: requestedRecord } });

		await expect(workOrderRequestShipCommand(requested.context)).rejects.toThrow(/process\.exit/);

		// the stored ids, not the tokens that were typed, are what the work order
		// is now held to — so those are what the command reads back
		expect(requested.logged.join('\n')).toContain('001-search');
		expect(requested.logged.join('\n')).toContain('002-fix');
		expect(requested.exitCodes).toStrictEqual([0]);

		const withdrawn = setupRequestShip({ args: ['--name', 'lo-140-x', '--withdraw'] });

		await expect(workOrderRequestShipCommand(withdrawn.context)).rejects.toThrow(/process\.exit/);

		// with no request left, the work order ships on nobody's authority: the
		// line has to say that rather than name a set of plans
		expect(withdrawn.logged.join('\n')).toContain('no ship request');
		expect(withdrawn.exitCodes).toStrictEqual([0]);
	});

	test('refuses --plans and --withdraw together or neither under the work-order command word', async () => {
		const both = setupRequestShip({ args: ['--name', 'lo-140-x', '--plans', '1', '--withdraw'] });

		await expect(workOrderRequestShipCommand(both.context)).rejects.toThrow(/process\.exit/);

		// recording a request and withdrawing one are opposite changes to the same
		// field, so the command refuses rather than picking one — and it spells
		// itself under the command word it now answers to
		expect(both.errors).toHaveLength(1);
		expect(both.errors[0] ?? '').toContain('--plans');
		expect(both.errors[0] ?? '').toContain('--withdraw');
		expect(both.errors[0] ?? '').toContain('lightsout work-order request-ship');
		expect(both.errors[0] ?? '').not.toContain('lightsout ticket ');
		expect(both.logged).toStrictEqual([]);
		expect(both.exitCodes).toStrictEqual([1]);

		const neither = setupRequestShip({ args: ['--name', 'lo-140-x'] });

		await expect(workOrderRequestShipCommand(neither.context)).rejects.toThrow(/process\.exit/);

		expect(neither.errors).toHaveLength(1);
		expect(neither.errors[0] ?? '').toContain('--plans');
		expect(neither.errors[0] ?? '').toContain('--withdraw');
		expect(neither.errors[0] ?? '').toContain('lightsout work-order request-ship');
		expect(neither.errors[0] ?? '').not.toContain('lightsout ticket ');
		expect(neither.logged).toStrictEqual([]);
		expect(neither.exitCodes).toStrictEqual([1]);

		// neither call changed the record, on either path
		expect(mockRequestTicketShip).not.toHaveBeenCalled();
		expect(mockWithdrawTicketShipRequest).not.toHaveBeenCalled();

		const one = setupRequestShip({ args: ['--name', 'lo-140-x', '--withdraw'] });

		await expect(workOrderRequestShipCommand(one.context)).rejects.toThrow(/process\.exit/);

		// with exactly one of the pair given, the intent reaches its operation and
		// the command ends cleanly
		expect(mockWithdrawTicketShipRequest.mock.calls[0]?.[0]).toMatchObject({ cwd: one.cwd, ticketBranch: 'lo-140-x' });
		expect(one.errors).toStrictEqual([]);
		expect(one.exitCodes).toStrictEqual([0]);
	});
});
