import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { workOrderModeCommand } from '#src/cli/workOrder/workOrderModeCommand.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { WorkOrderMode } from '#src/contracts/workOrder/WorkOrderMode.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';

// Mocked Imports
// -------------------------
// The mode switch itself belongs to the ticket module: what this file owns is
// which mode word reaches it, whether --approve reached it as it was given, and
// how the command ends. The subject is imported from its own file rather than
// the folder's barrel — the test sits inside the module, and the barrel would
// load every sibling subcommand against a ticket module mocked to one export.
interface SetTicketModeParams {
	cwd: string;
	name: string;
	mode: WorkOrderMode;
	approve: boolean;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

interface WorkOrderStateChange {
	record: WorkOrderState;
	notice?: string;
	publishError?: string;
}

const mockSetTicketMode = jest.fn<(params: SetTicketModeParams) => Promise<WorkOrderStateChange | { error: string }>>();

jest.mock('#src/workOrder/setWorkOrderMode.ts', () => ({ setWorkOrderMode: (params: SetTicketModeParams) => mockSetTicketMode(params) }));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

/** The record the action answers with once it has carried the switch out. */
const switchedRecord: WorkOrderState = {
	schemaVersion: 1,
	name: 'lo-140-x',
	ticketRef: 'LO-140',
	branch: 'lo-140-x',
	mode: 'single-plan',
	plans: [{ id: '001-search-basics', title: 'Search basics', progress: 'ready', createdAt: '2026-09-12T00:00:00.000Z' }],
	history: [{ at: '2026-09-12T00:00:01.000Z', kind: 'mode-changed', detail: 'mode set to single-plan' }],
};

/** The same work order once an approved switch to single-plan mode has dropped its later plans. */
const narrowedRecord: WorkOrderState = {
	...switchedRecord,
	plans: [
		{ id: '001-search-basics', title: 'Search basics', progress: 'ready', createdAt: '2026-09-12T00:00:00.000Z' },
		{
			id: '002-fix-search',
			title: 'Fix search',
			progress: 'planning',
			createdAt: '2026-09-12T00:00:02.000Z',
			exclusion: { at: '2026-09-12T00:00:03.000Z', reason: 'switched to single-plan mode', implementationRemoved: false },
		},
		{
			id: '003-drop-cache',
			title: 'Drop cache',
			progress: 'planning',
			createdAt: '2026-09-12T00:00:04.000Z',
			exclusion: { at: '2026-09-12T00:00:03.000Z', reason: 'switched to single-plan mode', implementationRemoved: false },
		},
	],
};

const setupMode = ({
	args,
	outcome = { record: switchedRecord },
}: {
	args: string[];
	/** What the action answers: a carried-out switch, by default. */
	outcome?: WorkOrderStateChange | { error: string };
}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-work-order-mode-command-'));

	mockSetTicketMode.mockResolvedValue(outcome);

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock }));

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('workOrderModeCommand', () => {
	test('refuses an unknown --set value under the work-order command word and passes a valid mode through with --approve', async () => {
		const { context: refused, errors, exitCodes } = setupMode({ args: ['--name', 'lo-140-x', '--set', 'sideways'] });

		await expect(workOrderModeCommand(refused)).rejects.toThrow(/process\.exit/);

		// A word the record cannot hold never reaches the action, and the refusal
		// names both modes so the caller can retype the flag from it alone. It must
		// also spell no `lightsout ticket <word>` command: after the rename that
		// command word no longer exists, so a sentence carrying it names nothing a
		// reader can run.
		expect(mockSetTicketMode).not.toHaveBeenCalled();
		expect(errors.join('\n')).toEqual(expect.stringContaining('single-plan'));
		expect(errors.join('\n')).toEqual(expect.stringContaining('multiple-plan'));
		expect(errors.join('\n')).not.toContain('lightsout ticket ');
		expect(exitCodes).toStrictEqual([1]);

		const { context: approved, cwd } = setupMode({ args: ['--name', 'lo-140-x', '--set', 'single-plan', '--approve'] });

		await expect(workOrderModeCommand(approved)).rejects.toThrow(/process\.exit/);

		expect(mockSetTicketMode.mock.calls[0]?.[0]).toMatchObject({ cwd, name: 'lo-140-x', mode: 'single-plan', approve: true });
	});

	test('refuses an unknown mode and names both modes', async () => {
		const { context, errors, exitCodes } = setupMode({ args: ['--name', 'lo-140-x', '--set', 'sideways'] });

		await expect(workOrderModeCommand(context)).rejects.toThrow(/process\.exit/);

		// A word the record cannot hold never reaches the action: the two modes are
		// named here so the caller can retype the flag from the refusal alone.
		expect(mockSetTicketMode).not.toHaveBeenCalled();
		expect(errors.join('\n')).toEqual(expect.stringContaining('single-plan'));
		expect(errors.join('\n')).toEqual(expect.stringContaining('multiple-plan'));
		expect(exitCodes).toStrictEqual([1]);
	});

	test('passes the mode and whether --approve was given', async () => {
		const { context: approved, cwd, logged: approvedLogged } = setupMode({ args: ['--name', 'lo-140-x', '--set', 'single-plan', '--approve'] });

		await expect(workOrderModeCommand(approved)).rejects.toThrow(/process\.exit/);

		expect(mockSetTicketMode.mock.calls[0]?.[0]).toMatchObject({ cwd, name: 'lo-140-x', mode: 'single-plan', approve: true });
		// a switch that dropped nothing says so by having no excluded-plans line at
		// all, rather than an empty one
		expect(approvedLogged).toHaveLength(1);
		expect(approvedLogged[0] ?? '').toContain('single-plan');

		// Without the flag the switch is the preview that changes nothing, so an
		// absent --approve must reach the action as false rather than as nothing.
		const { context: unapproved } = setupMode({ args: ['--name', 'lo-140-x', '--set', 'single-plan'] });

		await expect(workOrderModeCommand(unapproved)).rejects.toThrow(/process\.exit/);

		expect(mockSetTicketMode.mock.calls[1]?.[0]?.approve).toBe(false);
	});

	test("names the work order's new mode and every plan the switch excluded", async () => {
		const { context, logged, errors, exitCodes } = setupMode({
			args: ['--name', 'lo-140-x', '--set', 'single-plan', '--approve'],
			outcome: { record: narrowedRecord, notice: 'plan 001 alone determines this work order now' },
		});

		await expect(workOrderModeCommand(context)).rejects.toThrow(/process\.exit/);

		const output = logged.join('\n');

		expect(output).toContain('single-plan');
		// a human who approved the switch has to be able to see which plans it cost
		// them, by the ids they type back at the other subcommands
		expect(output).toContain('002-fix-search');
		expect(output).toContain('003-drop-cache');
		// an exclusion drops a plan from the order, and never deletes its work
		expect(output).toContain('their files stay on disk');
		// the plan the work order kept is not reported as one it dropped
		expect(output).not.toContain('001-search-basics');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});
});
