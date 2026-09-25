import { join, resolve } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { openImplementWorkspace } from '#src/cli/internal/common/implementRun/openImplementWorkspace.ts';
import type { PlanTarget } from '#src/cli/internal/common/types/PlanTarget.ts';
import type { RunWorkspace } from '#src/cli/internal/common/types/RunWorkspace.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';

// Mocked Imports
// -------------------------
// The resolver is mocked so each case can state the one fact it is about —
// which checkout the run builds in, and whether lightsout cut it.
interface ResolveWorkspaceParams {
	cwd: string;
	config: LightsoutConfig;
	flags: CommandContext['flags'];
	planPath?: string;
	onProgress?: (message: string) => void;
}

const mockResolveRunWorkspace = jest.fn<(params: ResolveWorkspaceParams) => Promise<RunWorkspace | { error: string }>>();

jest.mock('#src/cli/internal/common/implementRun/resolveRunWorkspace.ts', () => ({
	resolveRunWorkspace: (params: ResolveWorkspaceParams) => mockResolveRunWorkspace(params),
}));
// -------------------------
interface CopyInputsParams {
	sourceCwd: string;
	workspace: string;
	planPath?: string;
	ticketPath?: string;
}

const mockCopyRunInputs = jest.fn<(params: CopyInputsParams) => Promise<{ planPath?: string; ticketPath?: string } | { error: string }>>();

jest.mock('#src/cli/internal/common/implementRun/copyRunInputs.ts', () => ({
	copyRunInputs: (params: CopyInputsParams) => mockCopyRunInputs(params),
}));
// -------------------------
const mockResolvePlanTarget = jest.fn<(params: { cwd: string; planPath: string }) => Promise<PlanTarget | { error: string }>>();

jest.mock('#src/cli/internal/common/utils/resolvePlanTarget.ts', () => ({
	resolvePlanTarget: (params: { cwd: string; planPath: string }) => mockResolvePlanTarget(params),
}));
// -------------------------
// The dirty-tree guard is NOT mocked: it is the behaviour these rows are
// about, so what it reads is mocked instead and the real guard decides.
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({
	readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params),
}));
// -------------------------

const launchedFrom = resolve('/tmp/lightsout-implement-checkout');
const worktreePath = resolve('/tmp/lightsout-implement-worktrees/lo-152-one-commit');
const branch = 'lo-152-one-commit';
const planPath = join('.lightsout', 'plans', branch, '001-one-commit', 'plan.md');
const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };

/**
 * The command's own arguments, and what the mocked resolver, copier, target
 * reader and git status answer beneath them.
 *
 * `isolated` is the whole variable of these rows: a tree lightsout cut for the
 * run, against the checkout a person chose themselves with `--no-worktree`.
 */
const setupImplementWorkspace = ({ isolated = false, dirty = [] }: { isolated?: boolean; dirty?: string[] } = {}) => {
	const workspace: RunWorkspace = isolated
		? { cwd: worktreePath, branch, isolated: true, created: true }
		: { cwd: launchedFrom, isolated: false, created: false };

	mockResolveRunWorkspace.mockResolvedValue(workspace);
	mockReadGitChangedFiles.mockResolvedValue(dirty);
	mockCopyRunInputs.mockResolvedValue({ planPath });
	mockResolvePlanTarget.mockResolvedValue({ planPath });
	jest.spyOn(console, 'log').mockImplementation(() => undefined);

	return { params: { cwd: launchedFrom, config, flags: new Map<string, string | true>(), planPath }, workspace };
};

describe('openImplementWorkspace', () => {
	test('refuses a dirty workspace before any input is copied', async () => {
		const { params } = setupImplementWorkspace({ dirty: ['src/thing.ts'] });

		const opened = await openImplementWorkspace(params);

		expect({
			refused: 'error' in opened && opened.error.length > 0,
			judged: mockReadGitChangedFiles.mock.calls[0]?.[0],
			copies: mockCopyRunInputs.mock.calls.length,
		}).toStrictEqual({ refused: true, judged: { cwd: launchedFrom }, copies: 0 });
	});

	test('proceeds in an isolated workspace that is not clean', async () => {
		const { params, workspace } = setupImplementWorkspace({ isolated: true, dirty: ['src/thing.ts'] });

		const opened = await openImplementWorkspace(params);

		expect({ opened, copies: mockCopyRunInputs.mock.calls.length }).toStrictEqual({
			opened: { workspace, target: { planPath } },
			copies: 1,
		});
	});

	test('opens a clean workspace unchanged', async () => {
		const { params, workspace } = setupImplementWorkspace();

		const opened = await openImplementWorkspace(params);

		expect({
			opened,
			copied: mockCopyRunInputs.mock.calls[0]?.[0],
			resolved: mockResolvePlanTarget.mock.calls[0]?.[0],
		}).toStrictEqual({
			opened: { workspace, target: { planPath } },
			copied: { sourceCwd: launchedFrom, workspace: launchedFrom, planPath },
			resolved: { cwd: launchedFrom, planPath },
		});
	});
});
