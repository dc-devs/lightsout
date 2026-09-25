import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { workOrderCommand } from '#src/cli/workOrder/workOrderCommand.ts';
import { workOrderNewCommand } from '#src/cli/workOrder/workOrderNewCommand.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// Allocating the label, the branch and the record is the work order module's
// job: all this file owns is what reaches that operation, what the command
// prints, and how it ends.
interface CreateWorkOrderParams {
	cwd: string;
	ticketRef?: string;
	title?: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	driver?: Driver;
	onProgress?: (message: string) => void;
}

type CreateWorkOrderResult = { name: string; branch: string; record: WorkOrderState } | { error: string };

const mockCreateWorkOrder = jest.fn<(params: CreateWorkOrderParams) => Promise<CreateWorkOrderResult>>();

jest.mock('#src/workOrder/createWorkOrder.ts', () => ({ createWorkOrder: (params: CreateWorkOrderParams) => mockCreateWorkOrder(params) }));
// -------------------------
// The dispatcher loads every subcommand beside this one, and each of those is
// its own entry point — reading a record, publishing to a tracker. They are
// stubbed through one shared spy, because the only thing this file asks of them
// is that the word `new` reaches none of them.
const mockSiblingSubcommand = jest.fn<(params: CommandContext) => Promise<void>>();

jest.mock('#src/cli/workOrder/workOrderAddPlanCommand.ts', () => ({
	workOrderAddPlanCommand: (params: CommandContext) => mockSiblingSubcommand(params),
}));
jest.mock('#src/cli/workOrder/workOrderModeCommand.ts', () => ({ workOrderModeCommand: (params: CommandContext) => mockSiblingSubcommand(params) }));
jest.mock('#src/cli/workOrder/workOrderRequestShipCommand.ts', () => ({
	workOrderRequestShipCommand: (params: CommandContext) => mockSiblingSubcommand(params),
}));
jest.mock('#src/cli/workOrder/workOrderExcludePlanCommand.ts', () => ({
	workOrderExcludePlanCommand: (params: CommandContext) => mockSiblingSubcommand(params),
}));
jest.mock('#src/cli/workOrder/workOrderRetitlePlanCommand.ts', () => ({
	workOrderRetitlePlanCommand: (params: CommandContext) => mockSiblingSubcommand(params),
}));
jest.mock('#src/cli/workOrder/workOrderShowCommand.ts', () => ({ workOrderShowCommand: (params: CommandContext) => mockSiblingSubcommand(params) }));
jest.mock('#src/cli/workOrder/workOrderSyncCommand.ts', () => ({ workOrderSyncCommand: (params: CommandContext) => mockSiblingSubcommand(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/**
 * The record a creation answers with: named from words alone, so it carries no
 * ticket reference, and branched under a prefix, so the branch is not the label.
 */
const record: WorkOrderState = {
	schemaVersion: 1,
	name: 'give-the-name-one',
	branch: 'feature/give-the-name-one',
	mode: 'multiple-plan',
	plans: [],
	history: [],
};

const setupWorkOrderNew = ({
	args = ['--title', 'give the name one author'],
	word = 'new',
	outcome = { name: 'give-the-name-one', branch: 'feature/give-the-name-one', record },
}: {
	args?: string[];
	/** The positional the dispatcher reads, for the rows that go through it. */
	word?: string;
	/** What the creator answers: a work order allocated from words, by default. */
	outcome?: CreateWorkOrderResult;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-new-command-'));

	mockCreateWorkOrder.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [word, ...args], cwd }, cwd, ...captured };
};

/**
 * Run a command to whichever ending it takes. `captureCommandOutput` makes
 * `process.exit` throw, so a command that ends on an exit code rejects rather
 * than returns — the codes it recorded are what the endings are read from, and
 * any other rejection is a real failure and is rethrown.
 */
const runToEnding = async (running: Promise<void>): Promise<void> => {
	await running.catch((error: unknown) => {
		if (!(error instanceof Error) || error.message !== 'process.exit') {
			throw error;
		}
	});
};

describe('workOrderNewCommand', () => {
	test('workOrderNewCommand: prints the label as its last line, and on a refusal prints the sentence to stderr and exits 1', async () => {
		const created = setupWorkOrderNew();

		await runToEnding(workOrderNewCommand(created.context));

		// the repo's own config reaches the creator, tracker block and all, and
		// the process environment is handed over rather than read a second time
		expect(mockCreateWorkOrder.mock.calls[0]?.[0]).toMatchObject({
			cwd: created.cwd,
			title: 'give the name one author',
			config: { 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } },
			onProgress: expect.any(Function),
		});
		expect(mockCreateWorkOrder.mock.calls[0]?.[0]?.env).toBe(process.env);

		// a calling skill reads the label off the last line, so the branch — which
		// is not the label under a prefixed template — has to land above it
		expect(created.logged.at(-1)).toBe('give-the-name-one');
		expect(created.logged.slice(0, -1).join('\n')).toContain('feature/give-the-name-one');
		expect(created.errors).toStrictEqual([]);
		expect(created.exitCodes.filter((code) => code !== 0)).toStrictEqual([]);

		const refused = setupWorkOrderNew({
			outcome: { error: 'give-the-name-one already names a work order — pass --title to name this one differently' },
		});

		await runToEnding(workOrderNewCommand(refused.context));

		// a refusal is the whole output: no work order was written, so there is no
		// label for a calling skill to read back off stdout
		expect(refused.logged).toStrictEqual([]);
		expect(refused.errors.join('\n')).toContain('already names a work order');
		expect(refused.errors.join('\n')).toContain('--title');
		expect(refused.exitCodes).toStrictEqual([1]);
	});

	test('workOrderCommand: dispatches the new word to the work-order creator, and still refuses an unknown word', async () => {
		const dispatched = setupWorkOrderNew();

		await runToEnding(workOrderCommand(dispatched.context));

		// the word reached this handler and no sibling subcommand's, which the
		// creator having run once is what shows
		expect(mockCreateWorkOrder).toHaveBeenCalledTimes(1);
		expect(mockCreateWorkOrder.mock.calls[0]?.[0]).toMatchObject({ cwd: dispatched.cwd, title: 'give the name one author' });
		expect(mockSiblingSubcommand).not.toHaveBeenCalled();
		expect(dispatched.logged.at(-1)).toBe('give-the-name-one');
		expect(dispatched.errors).toStrictEqual([]);

		const unknown = setupWorkOrderNew({ args: [], word: 'rename' });

		await runToEnding(workOrderCommand(unknown.context));

		// a word the dispatcher does not hold prints the help text and ends there:
		// nothing is created, so the creator's one call is still the earlier one
		expect(mockCreateWorkOrder).toHaveBeenCalledTimes(1);
		expect(unknown.errors).toHaveLength(1);
		expect(unknown.errors[0]).toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(unknown.logged).toStrictEqual([]);
		expect(unknown.exitCodes).toStrictEqual([1]);
	});
});
