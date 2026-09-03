import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { ticketStateCommand } from '#src/cli/ticketStateCommand.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { TrackerFailure, TrackerSettings, TrackerTicket } from '#src/ticketTracker/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { queueConfigBlock, ticketTrackerConfigBlock } from '#tests/helpers/queueConfigBlock.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The tracker read and the composed write are other modules' entry points, each
// covered by its own tests. What this file owns is which flag words the boundary
// accepts, what reaches the write, and how the command ends.
interface LifecycleParams {
	ticketId: string;
	planningStatus?: string;
	trackerStatus?: string;
	currentStatus?: string;
}

const mockGetTicketsByIdentifiers = jest.fn<(params: { settings: TrackerSettings; identifiers: string[] }) => Promise<TrackerTicket[] | TrackerFailure>>();
const mockUpdateTicketLifecycle = jest.fn<(params: LifecycleParams) => Promise<TrackerFailure | undefined>>();
const mockResolveTrackerSettings = jest.fn<(params: { config: LightsoutConfig; env: NodeJS.ProcessEnv }) => TrackerSettings | TrackerFailure>();

jest.mock('#src/ticketTracker/index.ts', () => ({
	getTicketsByIdentifiers: (params: { settings: TrackerSettings; identifiers: string[] }) => mockGetTicketsByIdentifiers(params),
	// Stubbed rather than run for real, so the credential never has to be planted
	// on `process.env` — which nothing restores between files.
	resolveTrackerSettings: (params: { config: LightsoutConfig; env: NodeJS.ProcessEnv }) => mockResolveTrackerSettings(params),
}));
jest.mock('#src/ticketLifecycle/updateTicketLifecycle.ts', () => ({
	updateTicketLifecycle: (params: LifecycleParams) => mockUpdateTicketLifecycle(params),
}));
// -------------------------

const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };

const ticket: TrackerTicket = {
	id: 'id-88',
	identifier: 'LO-88',
	title: 'Write a ticket state',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: ['planning-needs-plan'],
	status: 'Backlog',
	unfinishedBlockers: [],
};

/** A repo whose config names a tracker, with the read and the write answering whatever the test wants. */
const setupTicketState = ({
	args,
	found = [ticket],
	writeFailure,
	trackerSettings = trackerSettingsFixture(),
	queue,
}: {
	args: string[];
	found?: TrackerTicket[] | TrackerFailure;
	writeFailure?: TrackerFailure;
	/** What the tracker identity resolves to — the sentence form stands in for an unreachable tracker. */
	trackerSettings?: TrackerSettings | TrackerFailure;
	/** A `queue` block for the repo's config, for the cases whose lifecycle settings are the point. */
	queue?: Record<string, unknown>;
}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-ticket-state-'));

	mockGetTicketsByIdentifiers.mockResolvedValue(found);
	mockUpdateTicketLifecycle.mockResolvedValue(writeFailure);
	mockResolveTrackerSettings.mockReturnValue(trackerSettings);
	writeFileSync(
		join(cwd, 'lightsout.config.json'),
		JSON.stringify({ gates, 'ticket-tracker': ticketTrackerConfigBlock, ...(queue === undefined ? {} : { queue }) }),
	);

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, ...captured };
};

describe('ticketStateCommand', () => {
	test('writes both fields, names what it wrote, and exits 0', async () => {
		const { context, logged, exitCodes } = setupTicketState({
			args: ['--ref', 'LO-88', '--planning-status', 'planning-complete', '--tracker-status', 'ready'],
		});

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(
			expect.objectContaining({ ticketId: 'id-88', planningStatus: 'planning-complete', trackerStatus: 'ready', currentStatus: 'Backlog' }),
		);
		expect(logged).toStrictEqual(["LO-88: planning status 'planning-complete' and tracker status 'Ready to implement'"]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('writes the planning status alone, leaving implementation where it stands', async () => {
		const { context } = setupTicketState({ args: ['--ref', 'LO-88', '--planning-status', 'planning-needs-plan'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ planningStatus: 'planning-needs-plan', trackerStatus: undefined }));
	});

	test('writes the tracker status alone, naming the repository’s own spelling of the role it was handed', async () => {
		const { context, logged, exitCodes } = setupTicketState({ args: ['--ref', 'LO-88', '--tracker-status', 'ready'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockUpdateTicketLifecycle).toHaveBeenCalledWith(expect.objectContaining({ planningStatus: undefined, trackerStatus: 'ready' }));
		expect(logged).toStrictEqual(["LO-88: tracker status 'Ready to implement'"]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('resolves the tracker identity from the repo’s own config and the process environment', async () => {
		const { context } = setupTicketState({ args: ['--ref', 'LO-88', '--tracker-status', 'ready'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockResolveTrackerSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({ 'ticket-tracker': { provider: 'linear', team: 'LO', 'api-key-env': 'LINEAR_API_KEY' } }),
				env: process.env,
			}),
		);
	});

	test('refuses a call that would write nothing, because a command that writes nothing is a usage error', async () => {
		const { context, errors, exitCodes } = setupTicketState({ args: ['--ref', 'LO-88'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['ticket-state needs at least one of --planning-status or --tracker-status']);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('parses the planning status rather than trusting it, naming all five when the word is not one of them', async () => {
		const { context, errors, exitCodes } = setupTicketState({ args: ['--ref', 'LO-88', '--planning-status', 'route-direct'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0]).toBe(
			"unknown planning status 'route-direct' — expected one of planning-needs-brainstorm, planning-needs-plan, planning-ready-auto-plan, planning-complete, planning-not-needed",
		);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses done and says why: a ticket reaches it only when a merge is positively confirmed', async () => {
		const { context, errors } = setupTicketState({ args: ['--ref', 'LO-88', '--tracker-status', 'done'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0]).toContain('merge is positively confirmed');
		expect(errors[0]).toContain('expected one of ready, in-progress');
		expect(mockUpdateTicketLifecycle).not.toHaveBeenCalled();
	});

	test('refuses any other tracker status word too, naming the two roles a caller may write', async () => {
		const { context, errors } = setupTicketState({ args: ['--ref', 'LO-88', '--tracker-status', 'Backlog'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0]).toBe("unknown tracker status 'Backlog' — expected one of ready, in-progress");
	});

	test('without --ref it prints the usage text and exits 1, before any tracker is reached', async () => {
		const { context, errors, exitCodes } = setupTicketState({ args: ['--planning-status', 'planning-complete'] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(exitCodes).toStrictEqual([1]);
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('stops on the tracker identity’s own sentence when no tracker can be reached', async () => {
		const { context, errors, exitCodes } = setupTicketState({
			args: ['--ref', 'LO-88', '--tracker-status', 'ready'],
			trackerSettings: { error: 'the tracker API key is missing: set the `LINEAR_API_KEY` environment variable' },
		});

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['the tracker API key is missing: set the `LINEAR_API_KEY` environment variable']);
		expect(exitCodes).toStrictEqual([1]);
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('stops on the lifecycle settings’ own sentence when two planning statuses share one label', async () => {
		const { context, errors, exitCodes } = setupTicketState({
			args: ['--ref', 'LO-88', '--tracker-status', 'ready'],
			queue: { ...queueConfigBlock, 'planning-status-labels': { 'planning-complete': 'Shaped', 'planning-not-needed': 'Shaped' } },
		});

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors[0] ?? '').toContain("maps 'Shaped' to both planning-complete and planning-not-needed");
		expect(exitCodes).toStrictEqual([1]);
		expect(mockGetTicketsByIdentifiers).not.toHaveBeenCalled();
	});

	test('refuses when the ticket could not be read from the tracker at all, which is not the same as no such ticket', async () => {
		const { context, errors, exitCodes } = setupTicketState({
			args: ['--ref', 'LO-88', '--tracker-status', 'ready'],
			found: { error: 'the tracker answered 401' },
		});

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['LO-88 could not be read from the tracker: the tracker answered 401']);
		expect(exitCodes).toStrictEqual([1]);
		expect(mockUpdateTicketLifecycle).not.toHaveBeenCalled();
	});

	test('refuses when the tracker knows no ticket by that reference', async () => {
		const { context, errors, exitCodes } = setupTicketState({ args: ['--ref', 'LO-99', '--tracker-status', 'ready'], found: [] });

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['the tracker returned no ticket with the identifier LO-99']);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('exits non-zero when the write itself failed, which is how a calling skill learns it did not happen', async () => {
		const { context, errors, exitCodes } = setupTicketState({
			args: ['--ref', 'LO-88', '--tracker-status', 'in-progress'],
			writeFailure: { error: "no 'In Progress' transition" },
		});

		await expect(ticketStateCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(["LO-88 could not be written: no 'In Progress' transition"]);
		expect(exitCodes).toStrictEqual([1]);
	});
});
