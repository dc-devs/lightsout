import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { workOrderCommand } from '#src/cli/workOrder/workOrderCommand.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// workOrderCommand is a dispatcher: the only behaviour it owns is which
// subcommand runs, and which names it refuses before any of them runs. Each
// handler is its own entry point — reading a record, running gates, publishing
// to a tracker — so they are stubbed rather than driven.

const mockWorkOrderAddPlanCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockWorkOrderModeCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockWorkOrderRequestShipCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockWorkOrderExcludePlanCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockWorkOrderRetitlePlanCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockWorkOrderShowCommand = jest.fn<(params: CommandContext) => Promise<void>>();
const mockWorkOrderSyncCommand = jest.fn<(params: CommandContext) => Promise<void>>();

jest.mock('#src/cli/workOrder/internal/workOrderAddPlanCommand.ts', () => ({
	workOrderAddPlanCommand: (params: CommandContext) => mockWorkOrderAddPlanCommand(params),
}));
jest.mock('#src/cli/workOrder/internal/workOrderModeCommand.ts', () => ({
	workOrderModeCommand: (params: CommandContext) => mockWorkOrderModeCommand(params),
}));
jest.mock('#src/cli/workOrder/internal/workOrderRequestShipCommand.ts', () => ({
	workOrderRequestShipCommand: (params: CommandContext) => mockWorkOrderRequestShipCommand(params),
}));
jest.mock('#src/cli/workOrder/internal/workOrderExcludePlanCommand.ts', () => ({
	workOrderExcludePlanCommand: (params: CommandContext) => mockWorkOrderExcludePlanCommand(params),
}));
jest.mock('#src/cli/workOrder/internal/workOrderRetitlePlanCommand.ts', () => ({
	workOrderRetitlePlanCommand: (params: CommandContext) => mockWorkOrderRetitlePlanCommand(params),
}));
jest.mock('#src/cli/workOrder/internal/workOrderShowCommand.ts', () => ({
	workOrderShowCommand: (params: CommandContext) => mockWorkOrderShowCommand(params),
}));
jest.mock('#src/cli/workOrder/internal/workOrderSyncCommand.ts', () => ({
	workOrderSyncCommand: (params: CommandContext) => mockWorkOrderSyncCommand(params),
}));
// -------------------------

/** Every subcommand word, in the order the command's usage lists them, paired with the handler it must reach. */
const handlers: Record<string, jest.Mock<(params: CommandContext) => Promise<void>>> = {
	'add-plan': mockWorkOrderAddPlanCommand,
	mode: mockWorkOrderModeCommand,
	'request-ship': mockWorkOrderRequestShipCommand,
	'exclude-plan': mockWorkOrderExcludePlanCommand,
	'retitle-plan': mockWorkOrderRetitlePlanCommand,
	show: mockWorkOrderShowCommand,
	sync: mockWorkOrderSyncCommand,
};

const subcommands = Object.keys(handlers);

/** The words whose handler has run at least once, in the order above — what a dispatch is observed by. */
const routedSoFar = () => subcommands.filter((word) => (handlers[word]?.mock.calls.length ?? 0) > 0);

/** How many times each word's handler has run, in the order above — what "exactly once and no other" is observed by. */
const callCounts = () => subcommands.map((word) => handlers[word]?.mock.calls.length ?? 0);

const setupWorkOrderDispatch = ({ invocations }: { invocations: string[][] }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-command-'));

	for (const handler of Object.values(handlers)) {
		handler.mockResolvedValue(undefined);
	}

	const contexts = invocations.map((args) => ({ flags: parseFlags({ args }), rest: args, cwd }));

	return { contexts, cwd, ...captured };
};

describe('workOrderCommand', () => {
	test('dispatches each work-order subcommand to its own handler and exits 1 on a word it does not hold', async () => {
		// `adopt` was merged into `add-plan` and its `--from` form has since gone,
		// so the word reaches no handler of its own and falls to the same refusal
		// as `rename`
		const { contexts, errors, exitCodes } = setupWorkOrderDispatch({
			invocations: [...subcommands.map((word) => [word, '--name', 'lo-140-x']), ['rename', '--name', 'lo-140-x'], ['adopt', '--name', 'lo-140-x']],
		});

		const routed: string[][] = [];
		for (const context of contexts.slice(0, subcommands.length)) {
			await workOrderCommand(context);
			routed.push(routedSoFar());
		}
		const countsAfterDispatching = callCounts();

		for (const context of contexts.slice(subcommands.length)) {
			await expect(workOrderCommand(context)).rejects.toThrow(/process\.exit/);
		}
		const countsAfterUnknownWords = callCounts();

		// after the Nth word is dispatched, exactly the first N handlers have run:
		// a word routed to another subcommand's handler breaks the progression
		expect(routed).toStrictEqual(subcommands.map((_, index) => subcommands.slice(0, index + 1)));
		// each handler ran once and no handler ran twice, so no word reused another word's handler
		expect(countsAfterDispatching).toStrictEqual(subcommands.map(() => 1));
		// neither unknown word reached any handler at all
		expect(countsAfterUnknownWords).toStrictEqual(countsAfterDispatching);
		expect(errors).toHaveLength(2);
		expect(errors.every((line) => /^lightsout — deterministic engine for coding agents/.test(line))).toBe(true);
		expect(exitCodes).toStrictEqual([1, 1]);
	});

	test('refuses a plan address as --name spelling the work-order command word, and dispatches when no --name is given', async () => {
		// every subcommand acts on a whole work order, so a plan's own address
		// cannot address one — the refusal points at the folder segment it holds.
		// With no --name there is no name to read as an address, and a required
		// flag is each handler's own refusal rather than an eighth copy of it here
		const { contexts, errors, exitCodes } = setupWorkOrderDispatch({ invocations: [['show', '--name', 'lo-140-x/001-search'], ['show']] });

		await expect(workOrderCommand(contexts[0])).rejects.toThrow(/process\.exit/);
		const refusal = errors[0] ?? '';
		const routedAfterRefusal = routedSoFar();

		await workOrderCommand(contexts[1]);
		const routedAfterNoName = routedSoFar();

		expect(routedAfterRefusal).toStrictEqual([]);
		// the refusal spells the command under its new word, with the subcommand it was given
		expect(refusal).toMatch(/lightsout work-order show/);
		expect(refusal).not.toMatch(/lightsout ticket /);
		// the folder segment stands on its own in the sentence, rather than only inside
		// the address it was given, which is what tells the reader what to name instead
		expect(refusal).toMatch(/lo-140-x(?!\/)/);
		expect(routedAfterNoName).toStrictEqual(['show']);
		expect(errors).toHaveLength(1);
		expect(exitCodes).toStrictEqual([1]);
	});
});
