import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementDirectCommand } from '#src/cli/implementDirectCommand.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import type { QueueFailure } from '#src/queue/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Mocked Imports
// -------------------------
// The direct run spawns a harness and the commit writes git history — both
// covered by their own tests. What this command owns is the flags it reads, the
// dirty tree it refuses, the reference it derives, and the code it exits on.
const mockRunDirectWork = jest.fn<(params: { ticketBody: string; ticketRef: string; willShip?: boolean }) => Promise<PipelineResult>>();
const mockCommitTicketWork = jest.fn<(params: { message: string; runDir: string }) => Promise<{ committed: boolean } | QueueFailure>>();

jest.mock('#src/direct/index.ts', () => ({
	runDirectWork: (params: { ticketBody: string; ticketRef: string; willShip?: boolean }) => mockRunDirectWork(params),
}));
jest.mock('#src/queue/index.ts', () => ({ commitTicketWork: (params: { message: string; runDir: string }) => mockCommitTicketWork(params) }));
// -------------------------

const manifestOf = (status: RunStatus): RunManifest => ({
	runId: 'run-1234-abcd',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:03.000Z',
	plan: '.lightsout/runs/run-1234-abcd/ticket.md',
	harness: 'claude-code',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
});

/** A committed branch with a ticket file on it, and both collaborators stubbed green. */
const setupImplementDirect = ({
	args,
	branch = 'lo-70-drain',
	ticket = '# Drain the backlog\n\nBuild the thing.\n',
	dirty,
	ship,
	detached = false,
}: {
	args: string[];
	branch?: string;
	/** The ticket file's contents, or undefined to leave the path pointing at nothing. */
	ticket?: string;
	/** A file left uncommitted after the ticket file is committed. */
	dirty?: string;
	/** The config's `ship` block — a broken ticket pattern is how "no usable ship settings" is arranged. */
	ship?: unknown;
	/** Leave the checkout on a detached HEAD, which is a commit rather than a branch anything can be named after. */
	detached?: boolean;
}) => {
	const captured = captureCommandOutput();
	const { cwd } = setupBranchRepo({ branch });

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false }, ship }));

	if (ticket !== undefined) {
		writeFileSync(join(cwd, 'ticket.md'), ticket);
	}

	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm setup', { cwd, stdio: 'ignore' });

	if (detached) {
		execSync('git checkout -q --detach', { cwd, stdio: 'ignore' });
	}

	if (dirty !== undefined) {
		writeFileSync(join(cwd, 'stray.ts'), dirty);
	}

	mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf(RunStatus.Passed) });
	mockCommitTicketWork.mockResolvedValue({ committed: true });
	// LIGHTSOUT_NO_SHIP silently beats both the flag and the config, and the
	// session running this suite may well have it exported — a queue worker sets
	// it for exactly that reason. Pinned empty so the ship cases read the flags
	// the test typed. restoreMocks puts the real environment back after each test.
	jest.replaceProperty(process, 'env', { ...process.env, LIGHTSOUT_NO_SHIP: '' });

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('implementDirectCommand', () => {
	test('builds from the ticket file, labels the run with the branch’s ticket, and commits what passed', async () => {
		const { context, exitCodes } = setupImplementDirect({ args: ['--ticket', 'ticket.md'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'lo-70', ticketBody: '# Drain the backlog\n\nBuild the thing.\n' }));
		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ message: 'lo-70 Drain the backlog' }));
		expect(exitCodes).toStrictEqual([0]);
	});

	test('writes the commit message into the run the build just minted, so the run that owns the work owns its records', async () => {
		const { context, cwd } = setupImplementDirect({ args: ['--ticket', 'ticket.md'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockCommitTicketWork).toHaveBeenCalledWith(expect.objectContaining({ runDir: join(cwd, '.lightsout', 'runs', 'run-1234-abcd') }));
	});

	test('takes the reference from --ref when one is typed, rather than deriving it', async () => {
		const { context } = setupImplementDirect({ args: ['--ticket', 'ticket.md', '--ref', 'LO-99'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'LO-99' }));
	});

	test('falls back to the branch name when the branch carries no ticket the pattern reads', async () => {
		const { context } = setupImplementDirect({ args: ['--ticket', 'ticket.md'], branch: 'scratch' });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'scratch' }));
	});

	test('falls back to the branch name when the repo’s ticket pattern cannot be compiled at all', async () => {
		const { context } = setupImplementDirect({ args: ['--ticket', 'ticket.md'], ship: { 'ticket-pattern': '^(?<broken>' } });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// the reference only labels the run and the commit, so an unusable pattern names the branch rather than refusing
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'lo-70-drain' }));
	});

	test('labels the run `ticket` on a detached HEAD, where there is no branch name to fall back to', async () => {
		const { context } = setupImplementDirect({ args: ['--ticket', 'ticket.md'], detached: true });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'ticket' }));
	});

	test('refuses --ship and --no-ship together before the run starts, in the one sentence both ways into ship say', async () => {
		const { context, logged, errors, exitCodes } = setupImplementDirect({ args: ['--ticket', 'ticket.md', '--ship', '--no-ship'] });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['--ship and --no-ship contradict each other — pass at most one']);
		expect(logged).toStrictEqual([]);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test.each([
		{ label: '--ship was typed', args: ['--ship'], ship: undefined, willShip: true },
		{ label: 'nobody asked at all', args: [] as string[], ship: undefined, willShip: false },
		{ label: 'the config says after-implement', args: [] as string[], ship: { 'after-implement': true }, willShip: true },
		{ label: '--no-ship beats the config', args: ['--no-ship'], ship: { 'after-implement': true }, willShip: false },
	])('hands the run its ship intent when $label, so the manifest can carry a ship row', async ({ args, ship, willShip }) => {
		const { context } = setupImplementDirect({ args: ['--ticket', 'ticket.md', ...args], ship });

		// the run fails, which is what keeps the exit path from chaining into a
		// real ship — the intent this case is about is handed over before any of
		// that, and is handed over the same either way
		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Failed), error: 'tsc: 3 errors' });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// resolved once before the run rather than at its exit, exactly as
		// `implement` does it — a direct run ships the same way and must draw the
		// same row
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ willShip }));
	});

	test('names a ticket file that is not there, rather than building from nothing', async () => {
		const { context, errors, exitCodes } = setupImplementDirect({ args: ['--ticket', 'missing.md'], ticket: undefined });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['ticket file not found: missing.md']);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses a dirty tree, because the run ends by committing everything in it', async () => {
		const { context, errors, exitCodes } = setupImplementDirect({ args: ['--ticket', 'ticket.md'], dirty: 'export const stray = 1;\n' });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['implement-direct commits everything in the tree; commit or stash your changes first']);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses a tree git cannot read at all, for the same reason', async () => {
		const captured = captureCommandOutput();
		const { cwd } = setupBranchRepo();

		writeFileSync(join(cwd, 'ticket.md'), '# ticket\n');
		execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm setup && rm -rf .git', { cwd, stdio: 'ignore' });

		await expect(implementDirectCommand({ flags: parseFlags({ args: ['--ticket', 'ticket.md'] }), rest: [], cwd })).rejects.toThrow(/process\.exit/);

		expect(captured.errors[0]).toContain('needs a readable git worktree');
		expect(captured.exitCodes).toStrictEqual([1]);
	});

	test('never commits after a run that did not pass, so a failed build leaves the tree for a human', async () => {
		const { context, exitCodes } = setupImplementDirect({ args: ['--ticket', 'ticket.md'] });

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.Failed), error: 'tsc: 3 errors' });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('exits 2 on a parked run, the code that means work remains and a re-run picks it up', async () => {
		const { context, exitCodes } = setupImplementDirect({ args: ['--ticket', 'ticket.md'] });

		mockRunDirectWork.mockResolvedValue({ ok: false, manifest: manifestOf(RunStatus.PausedRateLimit), error: 'rate limited' });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(exitCodes).toStrictEqual([2]);
	});

	test('stops before any ship chaining when the commit itself could not be made', async () => {
		const { context, errors, exitCodes } = setupImplementDirect({ args: ['--ticket', 'ticket.md', '--ship'] });

		mockCommitTicketWork.mockResolvedValue({ error: 'git could not stage the work' });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['git could not stage the work']);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('stops before any ship chaining when the worker changed nothing — a run with no commit must never chain into ship', async () => {
		const { context, errors, exitCodes } = setupImplementDirect({ args: ['--ticket', 'ticket.md', '--ship'] });

		mockCommitTicketWork.mockResolvedValue({ committed: false });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['the worker changed nothing']);
		expect(exitCodes).toStrictEqual([1]);
	});
});
