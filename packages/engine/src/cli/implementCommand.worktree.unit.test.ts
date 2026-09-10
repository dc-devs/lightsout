import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { implementCommand } from '#src/cli/implementCommand.ts';
import type { WorktreeOwner } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

// Mocked Imports
// -------------------------
// The worktree module is the only place the workspace resolution touches git,
// and the temp repo these cases run in has no remote. Doubling it leaves the
// resolver, the branch derivation, the input copy and the record links running
// for real, which is what these cases are about: which checkout each step after
// the resolution is handed.
interface CreateWorktreeParams {
	cwd: string;
	branch: string;
	defaultBranch: string;
	setup?: string;
	owner: WorktreeOwner;
	reuseExisting: boolean;
	onProgress?: (message: string) => void;
}

const mockCreateWorktree = jest.fn<(params: CreateWorktreeParams) => Promise<string | { error: string }>>();
const mockFetchDefaultBranch = jest.fn<(params: { cwd: string }) => Promise<string | { error: string }>>();
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();

jest.mock('#src/worktree/index.ts', () => ({
	...jest.requireActual<typeof import('#src/worktree/index.ts')>('#src/worktree/index.ts'),
	createWorktree: (params: CreateWorktreeParams) => mockCreateWorktree(params),
	fetchDefaultBranch: (params: { cwd: string }) => mockFetchDefaultBranch(params),
	readBranchWorktree: (params: { cwd: string; branch: string }) => mockReadBranchWorktree(params),
}));
// -------------------------
// The three steps that follow the resolution, doubled so the checkout each one
// received is readable — that is the whole claim these cases make. Only the
// fields they assert on are named; the command forwards the rest untouched.
interface LifecycleParams {
	cwd: string;
}

interface PipelineParams {
	cwd: string;
	planPath: string;
}

interface ShipTailParams {
	cwd: string;
	result: PipelineResult;
}

const mockRequireImplementLifecycle = jest.fn<(params: LifecycleParams) => Promise<string | undefined>>();

jest.mock('#src/ticketLifecycle/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticketLifecycle/index.ts')>('#src/ticketLifecycle/index.ts'),
	requireImplementLifecycle: (params: LifecycleParams) => mockRequireImplementLifecycle(params),
}));
// -------------------------
const mockRunPipelineOrFailFast = jest.fn<(params: PipelineParams) => Promise<PipelineResult>>();

jest.mock('#src/cli/common/utils/runPipelineOrFailFast.ts', () => ({
	runPipelineOrFailFast: (params: PipelineParams) => mockRunPipelineOrFailFast(params),
}));
// -------------------------
const mockRunPhasesOrFailFast = jest.fn<(params: { cwd: string; overviewPath: string }) => Promise<PipelineResult>>();

jest.mock('#src/cli/common/utils/runPhasesOrFailFast.ts', () => ({
	runPhasesOrFailFast: (params: { cwd: string; overviewPath: string }) => mockRunPhasesOrFailFast(params),
}));
// -------------------------
const mockExitAfterImplement = jest.fn<(params: ShipTailParams) => Promise<void>>();

jest.mock('#src/cli/common/utils/exitAfterImplement.ts', () => ({
	exitAfterImplement: (params: ShipTailParams) => mockExitAfterImplement(params),
}));
// -------------------------
// The report card is silenced rather than asserted: it reads a run directory no
// mocked pipeline ever wrote, and its lines would sit between the startup lines
// these cases read.
const mockPrintResult = jest.fn<(params: { result: PipelineResult; cwd: string }) => Promise<void>>();

jest.mock('#src/cli/common/render/printResult.ts', () => ({
	printResult: (params: { result: PipelineResult; cwd: string }) => mockPrintResult(params),
}));
// -------------------------

/** The plan folder every case points `--plan` at, and the branch its name yields. */
const planFolder = join('.lightsout', 'plans', 'lo-42-add-widgets');
const branch = 'lo-42-add-widgets';

/** What the plan says when the run starts, and what a mid-run edit to the source would make it say. */
const planBody = '# Plan: add widgets\n';
const editedPlanBody = '# Plan: edited while the run was going\n';

/**
 * A run that passed. Nothing downstream of the pipeline is real here — the
 * report card and the ship tail are both doubled — so the result only has to be
 * the same object each of them is handed.
 */
const passedResult = { ok: true, manifest: { runId: 'aaaaaaaa-1111-2222-3333-444444444444' } } as unknown as PipelineResult;

/**
 * A real consumer repo holding a real plan folder, and a real directory standing
 * in for the worktree git would have cut.
 *
 * `fetchFailure` is how a workspace that cannot be resolved becomes observable,
 * and `editsSourcePlan` rewrites the launching checkout's own plan file at the
 * moment the pipeline starts — an edit that lands after the copy was taken. The
 * two `workspace*` switches leave something standing where the record link or
 * the input copy belongs, which is how each of those two steps is made to fail
 * with the real code running.
 */
const setupImplementWorktree = ({
	args,
	fetchFailure,
	editsSourcePlan = false,
	phased = false,
	blocked,
}: {
	args: string[];
	fetchFailure?: string;
	editsSourcePlan?: boolean;
	/** A plan folder holding an overview.md, so the run is every phase of one plan rather than a single one. */
	phased?: boolean;
	/**
	 * What is left standing in the workspace where one of the two steps after
	 * creation has to write: a runs directory of the workspace's own where the
	 * link belongs, a file where the whole state directory belongs, or a file
	 * where the copied plan folder belongs.
	 */
	blocked?: 'own-runs-dir' | 'state-file' | 'plan-file';
}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo();
	const workspace = mkdtempSync(join(tmpdir(), 'lightsout-workspace-'));
	const printedBeforeLifecycle: string[] = [];

	mkdirSync(join(cwd, planFolder), { recursive: true });
	writeFileSync(join(cwd, planFolder, phased ? 'overview.md' : 'plan.md'), planBody);

	if (phased) {
		writeFileSync(join(cwd, planFolder, 'phase1-add-widgets.md'), planBody);
	}

	if (blocked === 'own-runs-dir') {
		mkdirSync(join(workspace, '.lightsout', 'runs'), { recursive: true });
	}

	if (blocked === 'state-file') {
		writeFileSync(join(workspace, '.lightsout'), 'a file where the state directory belongs\n');
	}

	if (blocked === 'plan-file') {
		mkdirSync(join(workspace, '.lightsout', 'plans'), { recursive: true });
		writeFileSync(join(workspace, planFolder), 'a file where the plan folder belongs\n');
	}

	mockFetchDefaultBranch.mockResolvedValue(fetchFailure === undefined ? 'main' : { error: fetchFailure });
	mockReadBranchWorktree.mockResolvedValue(undefined);
	mockCreateWorktree.mockResolvedValue(workspace);
	mockRequireImplementLifecycle.mockImplementation(() => {
		printedBeforeLifecycle.push(...captured.logged);

		return Promise.resolve(undefined);
	});
	mockRunPipelineOrFailFast.mockImplementation(() => {
		if (editsSourcePlan) {
			writeFileSync(join(cwd, planFolder, 'plan.md'), editedPlanBody);
		}

		return Promise.resolve(passedResult);
	});
	mockRunPhasesOrFailFast.mockResolvedValue(passedResult);
	mockPrintResult.mockResolvedValue(undefined);
	mockExitAfterImplement.mockResolvedValue(undefined);

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, workspace, printedBeforeLifecycle, ...captured };
};

describe('implementCommand worktree isolation', () => {
	test('names the workspace and branch before any source work and runs there', async () => {
		const { context, workspace, printedBeforeLifecycle } = setupImplementWorktree({ args: ['--plan', planFolder] });

		await implementCommand(context);

		// the announcement is what a reader follows the run by, so it has to be on
		// the screen before the ticket write and before the pipeline — matched
		// loosely, because the sentence around them is human copy
		expect(printedBeforeLifecycle.join('\n')).toContain(workspace);
		expect(printedBeforeLifecycle.join('\n')).toContain(branch);
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace }));
	});

	test('runs the pipeline against the plan copied into the workspace', async () => {
		const { context, cwd, workspace } = setupImplementWorktree({ args: ['--plan', planFolder], editsSourcePlan: true });

		await implementCommand(context);

		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, planPath: join(planFolder, 'plan.md') }));
		// the source was rewritten the moment the pipeline started, and the plan the
		// run builds is untouched by it
		expect(readFileSync(join(cwd, planFolder, 'plan.md'), 'utf8')).toBe(editedPlanBody);
		expect(readFileSync(join(workspace, planFolder, 'plan.md'), 'utf8')).toBe(planBody);
	});

	test('builds in the launching checkout when the run opts out', async () => {
		const { context, cwd } = setupImplementWorktree({ args: ['--plan', planFolder, '--no-worktree'] });

		await implementCommand(context);

		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(mockRequireImplementLifecycle).toHaveBeenCalledWith(expect.objectContaining({ cwd }));
		expect(mockRunPipelineOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd, planPath: join(planFolder, 'plan.md') }));
		expect(mockExitAfterImplement).toHaveBeenCalledWith(expect.objectContaining({ cwd }));
	});

	test('exits on a workspace refusal without starting the run', async () => {
		const { context, errors, exitCodes } = setupImplementWorktree({
			args: ['--plan', planFolder],
			fetchFailure: 'git could not fetch origin: no remote named origin',
		});

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toMatch(/fetch/iu);
		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('refuses an impossible flag combination before creating a worktree', async () => {
		// --start-phase against a folder holding one plan.md: a refusal the flags
		// alone decide, which must land before a tree is cut for a run that cannot happen
		const { context, errors, exitCodes } = setupImplementWorktree({ args: ['--plan', planFolder, '--start-phase', '2'] });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('--start-phase');
		expect(mockFetchDefaultBranch).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('runs every phase of a plan folder in the workspace, not in the launching checkout', async () => {
		const { context, workspace } = setupImplementWorktree({ args: ['--plan', planFolder], phased: true });

		await implementCommand(context);

		expect(mockRunPhasesOrFailFast).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, overviewPath: join(planFolder, 'overview.md') }));
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
	});

	test('exits naming the directory standing where the run records have to be linked', async () => {
		// a real runs directory of the workspace's own would swallow every run
		// record the launching checkout is supposed to read back
		const { context, workspace, errors, exitCodes } = setupImplementWorktree({ args: ['--plan', planFolder], blocked: 'own-runs-dir' });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(join(workspace, '.lightsout', 'runs'));
		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('exits naming the launching checkout when the record links cannot be made at all', async () => {
		const { context, cwd, errors, exitCodes } = setupImplementWorktree({ args: ['--plan', planFolder], blocked: 'state-file' });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(cwd);
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('exits when the plan cannot be copied into the workspace, rather than building an empty one', async () => {
		const { context, workspace, errors, exitCodes } = setupImplementWorktree({ args: ['--plan', planFolder], blocked: 'plan-file' });

		await expect(implementCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain(workspace);
		expect(mockRequireImplementLifecycle).not.toHaveBeenCalled();
		expect(mockRunPipelineOrFailFast).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});
});
