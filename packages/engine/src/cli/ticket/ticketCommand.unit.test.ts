import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { ticketCommand } from '#src/cli/ticket/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// ticketCommand is a dispatcher: the only behaviour it owns is which
// subcommand runs, and which names it refuses before any of them runs. Each
// handler is its own entry point — reading a record, running gates, publishing
// to a tracker — so they are stubbed rather than driven.

const mockTicketAddPlanCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockTicketModeCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockTicketRequestShipCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockTicketExcludePlanCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockTicketRetitlePlanCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockTicketShowCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockTicketSyncCommand = jest.fn<(params: CommandContext) => Promise<void>>();

jest.mock('#src/cli/ticket/ticketAddPlanCommand.ts', () => ({ ticketAddPlanCommand: (params: CommandContext) => mockTicketAddPlanCommand(params) }));
jest.mock('#src/cli/ticket/ticketModeCommand.ts', () => ({ ticketModeCommand: (params: CommandContext) => mockTicketModeCommand(params) }));
jest.mock('#src/cli/ticket/ticketRequestShipCommand.ts', () => ({
	ticketRequestShipCommand: (params: CommandContext) => mockTicketRequestShipCommand(params),
}));
jest.mock('#src/cli/ticket/ticketExcludePlanCommand.ts', () => ({
	ticketExcludePlanCommand: (params: CommandContext) => mockTicketExcludePlanCommand(params),
}));
jest.mock('#src/cli/ticket/ticketRetitlePlanCommand.ts', () => ({
	ticketRetitlePlanCommand: (params: CommandContext) => mockTicketRetitlePlanCommand(params),
}));
jest.mock('#src/cli/ticket/ticketShowCommand.ts', () => ({ ticketShowCommand: (params: CommandContext) => mockTicketShowCommand(params) }));
jest.mock('#src/cli/ticket/ticketSyncCommand.ts', () => ({ ticketSyncCommand: (params: CommandContext) => mockTicketSyncCommand(params) }));
// -------------------------

/** Every subcommand word, in the order the command's usage lists them, paired with the handler it must reach. */
const handlers: Record<string, jest.Mock<(params: CommandContext) => Promise<void>>> = {
	'add-plan': mockTicketAddPlanCommand,
	mode: mockTicketModeCommand,
	'request-ship': mockTicketRequestShipCommand,
	'exclude-plan': mockTicketExcludePlanCommand,
	'retitle-plan': mockTicketRetitlePlanCommand,
	show: mockTicketShowCommand,
	sync: mockTicketSyncCommand,
};

const subcommands = Object.keys(handlers);

/** The words whose handler has run at least once, in the order above — what a dispatch is observed by. */
const routedSoFar = () => subcommands.filter((word) => (handlers[word]?.mock.calls.length ?? 0) > 0);

const setupTicketDispatch = ({ invocations }: { invocations: string[][] }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-command-'));

	for (const handler of Object.values(handlers)) {
		handler.mockResolvedValue(undefined);
	}

	const contexts = invocations.map((args) => ({ flags: parseFlags({ args }), rest: args, cwd }));

	return { contexts, cwd, ...captured };
};

describe('ticketCommand', () => {
	test('dispatches each ticket subcommand to its own handler', async () => {
		const { contexts } = setupTicketDispatch({ invocations: subcommands.map((word) => [word, '--name', 'lo-140-x']) });

		const routed: string[][] = [];
		for (const context of contexts) {
			await ticketCommand(context);
			routed.push(routedSoFar());
		}

		// after the Nth word is dispatched, exactly the first N handlers have run:
		// a word routed to another subcommand's handler breaks the progression
		expect(routed).toStrictEqual(subcommands.map((_, index) => subcommands.slice(0, index + 1)));
	});

	test('prints the usage and exits 1 for an unknown ticket subcommand', async () => {
		const { contexts, errors, exitCodes } = setupTicketDispatch({ invocations: [['rename', '--name', 'lo-140-x']] });

		await expect(ticketCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(exitCodes).toStrictEqual([1]);
		expect(routedSoFar()).toStrictEqual([]);
	});

	test('refuses adopt as an unknown ticket subcommand', async () => {
		// `adopt` was merged into `add-plan --from`, so the word reaches no
		// handler of its own any more and falls to the refusal above
		const { contexts, errors, exitCodes } = setupTicketDispatch({ invocations: [['adopt', '--name', 'lo-140-x']] });

		await expect(ticketCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(exitCodes).toStrictEqual([1]);
		expect(routedSoFar()).toStrictEqual([]);
	});

	test('dispatches a subcommand that was given no --name at all', async () => {
		// there is no name to read as an address, and a required flag is each
		// handler's own refusal — restating it here would be an eighth copy of it
		const { contexts, errors, exitCodes } = setupTicketDispatch({ invocations: [['show']] });

		await ticketCommand(contexts[0]);

		expect(routedSoFar()).toStrictEqual(['show']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([]);
	});

	test('refuses a plan address given as --name and names its ticket-branch segment', async () => {
		// every subcommand acts on the ticket, so a plan's own address cannot
		// address one — the refusal points at the ticket branch it holds
		const { contexts, errors, exitCodes } = setupTicketDispatch({ invocations: [['show', '--name', 'lo-140-x/001-search']] });

		await expect(ticketCommand(contexts[0])).rejects.toThrow(/process\.exit/);

		expect(errors).toHaveLength(1);
		// the branch stands on its own in the sentence, rather than only inside the
		// address it was given, which is what tells the reader what to name instead
		expect(errors[0] ?? '').toMatch(/lo-140-x(?!\/)/);
		expect(exitCodes).toStrictEqual([1]);
		expect(routedSoFar()).toStrictEqual([]);
	});
});
