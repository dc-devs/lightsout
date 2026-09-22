import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { workOrderExcludePlanCommand } from '#src/cli/workOrder/workOrderExcludePlanCommand.ts';
import type { LightsoutConfig, WorkOrderState } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// Excluding the plan — the branch verification, the gate run and the record
// change — belongs to the ticket module. What this file owns is which flags
// reach that operation and how the command ends. The subject is imported from
// its own file rather than the folder's barrel, because the barrel would load
// every sibling subcommand against a ticket module mocked down to one export.
interface ExcludeTicketPlanParams {
	cwd: string;
	ticketBranch: string;
	plan: string;
	reason: string;
	implementationRemoved: boolean;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type ExcludeTicketPlanResult = { record: WorkOrderState; notice?: string; publishError?: string } | { error: string };

const mockExcludeTicketPlan = jest.fn<(params: ExcludeTicketPlanParams) => Promise<ExcludeTicketPlanResult>>();

jest.mock('#src/ticket/index.ts', () => ({ excludeTicketPlan: (params: ExcludeTicketPlanParams) => mockExcludeTicketPlan(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** The work order as the exclusion leaves it: plan 002 dropped, its files still on disk. */
const excludedRecord: WorkOrderState = {
	schemaVersion: 1,
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'multiple-plan',
	plans: [
		{ id: '001-search', title: 'search', progress: 'implemented', createdAt: '2026-09-12T09:00:00.000Z' },
		{
			id: '002-fix',
			title: 'Fix',
			progress: 'implemented',
			createdAt: '2026-09-12T10:00:00.000Z',
			exclusion: { at: '2026-09-12T11:00:00.000Z', reason: 'dropped', implementationRemoved: true, verifiedCommit: 'abc1234' },
		},
	],
	history: [{ at: '2026-09-12T11:00:00.000Z', kind: 'plan-excluded', detail: 'plan 002-fix excluded: dropped' }],
};

const setupExcludePlan = ({ args, outcome = { record: excludedRecord } }: { args: string[]; outcome?: ExcludeTicketPlanResult }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-exclude-plan-command-'));

	mockExcludeTicketPlan.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('workOrderExcludePlanCommand', () => {
	test('passes the plan, the reason and the removal flag through after the work-order rename', async () => {
		const removed = setupExcludePlan({ args: ['--name', 'lo-140-x', '--plan', '2', '--reason', 'dropped', '--implementation-removed'] });

		await expect(workOrderExcludePlanCommand(removed.context)).rejects.toThrow(/process\.exit/);

		// the bare number reaches the operation exactly as typed — it is the
		// operation that decides which plan it names — and the declared removal is
		// what lets the branch verification record a verified commit
		expect(mockExcludeTicketPlan.mock.calls[0]?.[0]).toMatchObject({
			cwd: removed.cwd,
			ticketBranch: 'lo-140-x',
			plan: '2',
			reason: 'dropped',
			implementationRemoved: true,
			// the exclusion may run the repository's full gates, so its progress has
			// to reach the terminal while it works
			onProgress: expect.any(Function),
		});
		// the count is what the human checks the exclusion by, and the reassurance
		// beside it is the rule that an exclusion never deletes a plan's work
		expect(removed.logged.join('\n')).toContain('1 plan');
		expect(removed.logged.join('\n')).toContain("plan's files stay on disk");
		expect(removed.exitCodes).toStrictEqual([0]);

		const kept = setupExcludePlan({ args: ['--name', 'lo-140-x', '--plan', '2', '--reason', 'dropped'] });

		await expect(workOrderExcludePlanCommand(kept.context)).rejects.toThrow(/process\.exit/);

		// without the flag the human has declared nothing, so the exclusion must
		// not record a removal it cannot verify
		expect(mockExcludeTicketPlan.mock.calls[1]?.[0]).toMatchObject({ plan: '2', reason: 'dropped', implementationRemoved: false });
		expect(kept.exitCodes).toStrictEqual([0]);

		const missingReason = setupExcludePlan({ args: ['--name', 'lo-140-x', '--plan', '2'] });

		await expect(workOrderExcludePlanCommand(missingReason.context)).rejects.toThrow(/process\.exit/);

		// the reason is the record's only account of why the plan was dropped, so a
		// missing one is a usage error and nothing is excluded
		expect(mockExcludeTicketPlan).toHaveBeenCalledTimes(2);
		expect(missingReason.logged).toStrictEqual([]);
		expect(missingReason.errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(missingReason.exitCodes).toStrictEqual([1]);
	});
});
