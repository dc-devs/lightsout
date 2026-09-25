import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { workOrderRetitlePlanCommand } from '#src/cli/workOrder/workOrderRetitlePlanCommand.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Changing the title is the ticket module's job: what this file owns is which
// flags reach that operation, what the command prints, and how it ends. The
// subject is imported from its own file rather than the folder's barrel — the
// test sits inside the module, and the barrel would load every sibling
// subcommand against a ticket module mocked down to one export.
interface RetitleParams {
	cwd: string;
	name: string;
	plan: string;
	title: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type RetitleResult = { record: WorkOrderState; notice?: string; publishError?: string } | { error: string };

const mockRetitleTicketPlan = jest.fn<(params: RetitleParams) => Promise<RetitleResult>>();

jest.mock('#src/workOrder/retitleWorkOrderPlan.ts', () => ({ retitleWorkOrderPlan: (params: RetitleParams) => mockRetitleTicketPlan(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** A ticket whose plan 002 now carries the new display title. */
const retitledRecord: WorkOrderState = {
	schemaVersion: 1,
	name: 'lo-140-x',
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'multiple-plan',
	plans: [
		{ id: '001-search', title: 'search', progress: 'implemented', createdAt: '2026-09-12T00:00:00.000Z' },
		{ id: '002-fix', title: 'New', progress: 'ready', createdAt: '2026-09-12T01:00:00.000Z' },
	],
	history: [{ at: '2026-09-12T02:00:00.000Z', kind: 'plan-retitled', detail: 'plan 002-fix is now titled New' }],
};

const setupRetitle = ({ args, result = { record: retitledRecord } }: { args: string[]; result?: RetitleResult }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-retitle-plan-command-'));

	mockRetitleTicketPlan.mockResolvedValue(result);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('workOrderRetitlePlanCommand', () => {
	test('passes the plan and the new title through after the work-order rename', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupRetitle({ args: ['--name', 'lo-140-x', '--plan', '2', '--title', 'New'] });

		await expect(workOrderRetitlePlanCommand(context)).rejects.toThrow(/process\.exit/);

		// the plan token reaches the operation exactly as it was typed: a bare
		// number is the operation's own to resolve against the ticket's ids
		expect(mockRetitleTicketPlan.mock.calls[0]?.[0]).toMatchObject({ cwd, name: 'lo-140-x', plan: '2', title: 'New' });
		// the title the plan now carries is read back, so a human sees what the
		// record holds rather than only that something happened
		expect(logged.join('\n')).toContain('New');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);

		const missingTitle = setupRetitle({ args: ['--name', 'lo-140-x', '--plan', '2'] });

		await expect(workOrderRetitlePlanCommand(missingTitle.context)).rejects.toThrow(/process\.exit/);

		// a missing title is a usage error: there is no new title to record, so the
		// operation is never reached
		expect(mockRetitleTicketPlan).toHaveBeenCalledTimes(1);
		expect(missingTitle.logged).toStrictEqual([]);
		expect(missingTitle.errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(missingTitle.exitCodes).toStrictEqual([1]);
	});
});
