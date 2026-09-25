import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { workOrderAddPlanCommand } from '#src/cli/workOrder/workOrderAddPlanCommand.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Adding the plan is the work order module's job: all this file owns is what
// reaches that operation, what the command prints, and how it ends. `from` is
// kept on the params shape below so the row that pins the removed flag can ask
// whether any value reached the operation for it. The subject is imported from
// its own file rather than the folder's barrel, because the barrel would load
// every sibling subcommand against a work order module mocked down to one
// export.
interface AddTicketPlanParams {
	cwd: string;
	name: string;
	slug: string;
	title?: string;
	from?: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type AddTicketPlanResult = { address: string; record: WorkOrderState; notice?: string; publishError?: string } | { error: string };

const mockAddTicketPlan = jest.fn<(params: AddTicketPlanParams) => Promise<AddTicketPlanResult>>();

jest.mock('#src/workOrder/index.ts', () => ({ addWorkOrderPlan: (params: AddTicketPlanParams) => mockAddTicketPlan(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

const record: WorkOrderState = {
	schemaVersion: 1,
	name: 'lo-140-x',
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
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-add-plan-command-'));

	mockAddTicketPlan.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/**
 * An add for a work order whose plans folder already holds loose files: the
 * files are written where a `--from` add used to find them, so the assertions
 * below are about a command that no longer looks there at all.
 */
const setupLooseFilesAdd = () => {
	const added = setupAddPlan({
		args: ['--name', 'lo-140-x', '--slug', 'fix', '--title', 'Fix'],
		outcome: {
			address: 'lo-140-x/003-fix',
			record: {
				...record,
				plans: [
					{ id: '001-first', title: 'First', progress: 'implemented', createdAt: '2026-09-10T10:00:00.000Z' },
					{ id: '002-second', title: 'Second', progress: 'ready', createdAt: '2026-09-11T10:00:00.000Z' },
					{ id: '003-fix', title: 'Fix', progress: 'planning', createdAt: '2026-09-12T10:00:00.000Z' },
				],
			},
		},
	});
	const plansDir = join(added.cwd, '.lightsout', 'work-orders', 'lo-140-x', 'plans');

	mkdirSync(plansDir, { recursive: true });
	writeFileSync(join(plansDir, 'search-notes.md'), '# loose notes\n');
	writeFileSync(join(plansDir, 'decisions.json'), '[]');

	return added;
};

describe('workOrderAddPlanCommand', () => {
	test('prints the plan address last on a successful work-order add-plan and exits 1 on a refusal', async () => {
		const added = setupAddPlan({
			outcome: { address: 'lo-140-x/003-fix', record, notice: 'the pending ship request was withdrawn because plan 003-fix was added' },
		});

		await expect(workOrderAddPlanCommand(added.context)).rejects.toThrow(/process\.exit/);

		// the repo's own config reaches the operation, tracker block and all —
		// without it the record change can resolve no tracker to publish to
		expect(mockAddTicketPlan.mock.calls[0]?.[0]).toMatchObject({
			cwd: added.cwd,
			name: 'lo-140-x',
			slug: 'fix',
			title: 'Fix',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
			onProgress: expect.any(Function),
		});
		// the process environment is handed over rather than read inside the
		// operation, which is what keeps the API key out of a second reader
		expect(mockAddTicketPlan.mock.calls[0]?.[0]?.env).toBe(process.env);

		const noticeIndex = added.logged.findIndex((line) => line.includes('withdrawn'));

		// a skill reads the address off the last line, so the notice must land
		// before the command's own lines rather than after them
		expect(noticeIndex).toBeGreaterThanOrEqual(0);
		expect(noticeIndex).toBeLessThan(added.logged.length - 1);
		expect(added.logged.at(-1)).toContain('lo-140-x/003-fix');
		expect(added.errors).toStrictEqual([]);
		expect(added.exitCodes).toStrictEqual([0]);

		const refused = setupAddPlan({
			outcome: { error: 'lo-140-x is in single-plan mode and already holds plan 001 — run lightsout work-order mode --set multiple-plan first' },
		});

		await expect(workOrderAddPlanCommand(refused.context)).rejects.toThrow(/process\.exit/);

		// a refusal is the whole output: nothing reached disk, so there is no
		// address for a calling skill to read back
		expect(refused.logged).toStrictEqual([]);
		expect(refused.errors.join('\n')).toContain('lightsout work-order mode --set multiple-plan');
		expect(refused.errors.join('\n')).not.toContain('lightsout ticket ');
		expect(refused.exitCodes).toStrictEqual([1]);
	});

	test('prints only the plan count and the address', async () => {
		const { context, cwd, logged, errors, exitCodes } = setupLooseFilesAdd();

		await expect(workOrderAddPlanCommand(context)).rejects.toThrow(/process\.exit/);

		// nothing names a source folder any more, so no value reaches the
		// operation for one — the plan is started, not built out of loose files
		expect(mockAddTicketPlan.mock.calls[0]?.[0]).toMatchObject({ cwd, name: 'lo-140-x', slug: 'fix', title: 'Fix' });
		expect(mockAddTicketPlan.mock.calls[0]?.[0]?.from).toBeUndefined();

		// two lines and no third: how many plans the work order now holds, then
		// the address a calling skill reads back off the last line
		expect(logged).toHaveLength(2);
		expect(logged[0]).toContain('lo-140-x');
		expect(logged[0]).toMatch(/3 plan/);
		expect(logged.at(-1)).toBe('lo-140-x/003-fix');
		// the loose files in the plans folder are not this command's business,
		// so nothing it prints mentions them or how far they had got
		expect(logged.join('\n')).not.toMatch(/loose|search-notes|--from/i);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('keeps the local change and exits 1 naming work-order sync when publishing fails', async () => {
		const { context, logged, errors, exitCodes } = setupAddPlan({
			outcome: { address: 'lo-140-x/003-fix', record, publishError: 'the tracker refused the attachment: 503 service unavailable' },
		});

		await expect(workOrderAddPlanCommand(context)).rejects.toThrow(/process\.exit/);

		// the plan was added locally, so the address is still the command's answer;
		// only reaching the tracker failed, and that is what the retry is for
		expect(logged.at(-1)).toContain('lo-140-x/003-fix');
		expect(errors.join('\n')).toContain('503 service unavailable');
		expect(errors.join('\n')).toContain('lightsout work-order sync --name lo-140-x');
		// the retry sentence names the command word a reader can actually run
		expect(errors.join('\n')).not.toContain('lightsout ticket sync');
		expect(exitCodes).toStrictEqual([1]);
	});
});
