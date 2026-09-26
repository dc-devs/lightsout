import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { implementDirectCommand } from '#src/cli/implementDirectCommand.ts';
import type { RunWorkspace } from '#src/cli/internal/common/types/RunWorkspace.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { seedRunFolder } from '#tests/helpers/seedRunFolder.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Mocked Imports
// -------------------------
// What this file owns is which checkout each step of a direct run acts on. The
// workspace resolver is stubbed with the answer the real one documents for the
// flags each case types, so no case has to cut a real worktree; the harness,
// the commit and the ship tail are stubbed because each is covered by its own
// tests and each would otherwise leave the machine or write git history.
type ResolveRunWorkspaceParams = {
	cwd: string;
	config: LightsoutConfig;
	flags: CommandContext['flags'];
	planPath?: string;
	ticketPath?: string;
	ticketRef?: string;
	ticketBody?: string;
	onProgress?: (message: string) => void;
};
type DirectWorkParams = { cwd: string; ticketBody: string; ticketRef: string; willShip?: boolean };
type CommitParams = {
	cwd: string;
	composeMessage: ({ cwd }: { cwd: string }) => Promise<string>;
	runDir: string;
	generated: string[] | undefined;
	onProgress: (message: string) => void;
};
type ExitAfterImplementParams = {
	config: LightsoutConfig;
	cwd: string;
	result: PipelineResult;
	shipFlag: boolean;
	noShipFlag: boolean;
	env: NodeJS.ProcessEnv;
};

const mockResolveRunWorkspace = jest.fn<(params: ResolveRunWorkspaceParams) => Promise<RunWorkspace | { error: string }>>();

jest.mock('#src/cli/internal/common/implementRun/resolveRunWorkspace.ts', () => ({
	resolveRunWorkspace: (params: ResolveRunWorkspaceParams) => mockResolveRunWorkspace(params),
}));
// -------------------------
const mockRunDirectWork = jest.fn<(params: DirectWorkParams) => Promise<PipelineResult>>();

jest.mock('#src/direct/runDirectWork.ts', () => ({ runDirectWork: (params: DirectWorkParams) => mockRunDirectWork(params) }));
// -------------------------
const mockCommitTicketWork = jest.fn<(params: CommitParams) => Promise<{ committed: false } | { committed: true; message: string } | { error: string }>>();

jest.mock('#src/commit/commitWorkOrderWork.ts', () => ({ commitWorkOrderWork: (params: CommitParams) => mockCommitTicketWork(params) }));
// -------------------------
const mockExitAfterImplement = jest.fn<(params: ExitAfterImplementParams) => Promise<void>>();

jest.mock('#src/cli/internal/common/utils/exitAfterImplement.ts', () => ({
	exitAfterImplement: (params: ExitAfterImplementParams) => mockExitAfterImplement(params),
}));
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
	commits: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/**
 * Two real checkouts: the one the command is launched from, and the clean one
 * an isolated run is resolved into. The stub answers the launching checkout
 * when `--no-worktree` was typed and the second checkout otherwise, which is
 * what the real resolver answers for those same flags — or the one sentence
 * `workspaceRefusal` names, which is what the real one answers when no tree can
 * be cut. The input copy is left running for real throughout.
 */
const setupImplementDirectWorktree = ({
	args,
	launchBranch = 'lo-99-elsewhere',
	workspaceBranch = 'lo-70-drain',
	dirtyLaunch,
	workspaceRefusal,
	blocksTicketCopy = false,
}: {
	args: string[];
	/** The branch the launching checkout stands on — deliberately not the workspace's. */
	launchBranch?: string;
	/** The branch the isolated workspace was put on. */
	workspaceBranch?: string;
	/** A file left uncommitted in the launching checkout after its ticket file is committed. */
	dirtyLaunch?: string;
	/** The one sentence the resolver answers instead of a workspace. */
	workspaceRefusal?: string;
	/** A file where the workspace's lightsout state directory belongs, so the ticket copy cannot land. */
	blocksTicketCopy?: boolean;
}) => {
	const captured = captureCommandOutput();
	const { cwd } = setupBranchRepo({ branch: launchBranch });
	// A case that blocks the copy puts a FILE where the state directory belongs, so
	// that workspace must hold no work order record — which would make it a directory.
	const { cwd: workspace } = setupBranchRepo({ branch: workspaceBranch, workOrder: !blocksTicketCopy });

	writeFileSync(join(cwd, 'lightsout.config.json'), JSON.stringify({ gates: { check: 'true', test: 'true', 'test-coverage': false } }));
	writeFileSync(join(cwd, 'ticket.md'), '# Drain the backlog\n\nBuild the thing.\n');
	execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm setup', { cwd, stdio: 'ignore' });

	if (dirtyLaunch !== undefined) {
		writeFileSync(join(cwd, 'stray.ts'), dirtyLaunch);
	}

	if (blocksTicketCopy) {
		writeFileSync(join(workspace, '.lightsout'), 'a file where the state directory belongs\n');
		execSync('git add -A && git -c user.name=t -c user.email=t@t commit -qm block', { cwd: workspace, stdio: 'ignore' });
	}

	mockResolveRunWorkspace.mockImplementation(async ({ cwd: launchedFrom, flags }) => {
		if (workspaceRefusal !== undefined) {
			return { error: workspaceRefusal };
		}

		return flags.get('no-worktree') === true
			? { cwd: launchedFrom, isolated: false, created: false }
			: { cwd: workspace, branch: workspaceBranch, isolated: true, created: true };
	});
	// The build is stubbed, so the run folder a real `createRun` would have made
	// is planted in both checkouts — the command resolves the run's directory by
	// id, against whichever checkout the build ran in. A workspace whose state
	// directory is blocked gets none, which is the case that never builds.
	for (const checkout of blocksTicketCopy ? [cwd] : [cwd, workspace]) {
		seedRunFolder({ cwd: checkout, runId: manifestOf(RunStatus.Passed).runId, pipeline: 'direct' });
	}
	mockRunDirectWork.mockResolvedValue({ ok: true, manifest: manifestOf(RunStatus.Passed) });
	mockCommitTicketWork.mockResolvedValue({ committed: true, message: 'LO-70: stub subject\n\nlightsout run stub\n' });
	mockExitAfterImplement.mockResolvedValue(undefined);

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, workspace, ...captured };
};

describe('implementDirectCommand worktree isolation', () => {
	test('guards the workspace rather than the launching checkout', async () => {
		const { context, workspace, errors } = setupImplementDirectWorktree({ args: ['--ticket', 'ticket.md'], dirtyLaunch: 'export const stray = 1;\n' });

		await implementDirectCommand(context);

		// the tree the run must not sweep is the one it commits in, so a dirty
		// launching checkout stops mattering the moment the run builds elsewhere
		expect(errors).toStrictEqual([]);
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
	});

	test('builds and ships in the workspace, leaving the commit to the run', async () => {
		const { context, workspace } = setupImplementDirectWorktree({ args: ['--ticket', 'ticket.md'] });

		await implementDirectCommand(context);

		// the run makes its own commit before it is stamped passed, so this edge
		// hands the workspace to the run and to the ship tail and nothing else
		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
		expect(mockCommitTicketWork).not.toHaveBeenCalled();
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
	});

	test('still refuses a dirty launching checkout when the run opts out', async () => {
		const { context, errors, exitCodes } = setupImplementDirectWorktree({
			args: ['--ticket', 'ticket.md', '--no-worktree'],
			dirtyLaunch: 'export const stray = 1;\n',
		});

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual([`the run commits everything in the tree at ${context.cwd}; commit or stash your changes first`]);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('still refuses a dirty workspace through the shared guard', async () => {
		// `--no-worktree` makes the workspace the launching checkout, which is the
		// only workspace the shared guard judges: a tree lightsout cut or adopted
		// for the run is never judged at all.
		const { context, errors, exitCodes } = setupImplementDirectWorktree({
			args: ['--ticket', 'ticket.md', '--no-worktree'],
			dirtyLaunch: 'export const stray = 1;\n',
		});

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		// The refusal is human copy, and both implement commands now give it, so
		// only the act a reader takes from it is pinned — clear the tree first.
		// What matters here is that it still arrives, and before a worker is spawned.
		expect(errors.join('\n')).toMatch(/commit or stash/);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('labels the run from the branch the workspace was put on', async () => {
		const { context } = setupImplementDirectWorktree({ args: ['--ticket', 'ticket.md'], launchBranch: 'lo-99-elsewhere', workspaceBranch: 'lo-70-drain' });

		await implementDirectCommand(context);

		expect(mockRunDirectWork).toHaveBeenCalledWith(expect.objectContaining({ ticketRef: 'lo-70' }));
	});

	test('names the workspace, its branch and the copied ticket in the startup line', async () => {
		const { context, cwd, workspace, logged } = setupImplementDirectWorktree({ args: ['--ticket', 'ticket.md'] });

		await implementDirectCommand(context);

		// human copy, so only the facts a reader follows the run by are pinned:
		// where it builds, on what, and the copy it reads rather than the original
		const header = logged.find((line) => line.startsWith('lightsout: building')) ?? '';

		expect(header).toContain(workspace);
		expect(header).toContain('lo-70-drain');
		expect(header).toContain(join('.lightsout', 'inputs', 'ticket.md'));
		// the config is the launching checkout's, not the workspace's copy — so the file read is named outright
		expect(logged).toContain(`  config: ${join(cwd, 'lightsout.config.json')}`);
	});

	test('exits on a workspace refusal without building anything', async () => {
		const { context, errors, exitCodes } = setupImplementDirectWorktree({
			args: ['--ticket', 'ticket.md'],
			workspaceRefusal: 'git could not fetch origin: no remote named origin',
		});

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual(['git could not fetch origin: no remote named origin']);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('exits when the ticket cannot be copied into the workspace', async () => {
		const { context, workspace, errors, exitCodes } = setupImplementDirectWorktree({ args: ['--ticket', 'ticket.md'], blocksTicketCopy: true });

		await expect(implementDirectCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(workspace);
		expect(mockRunDirectWork).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});
