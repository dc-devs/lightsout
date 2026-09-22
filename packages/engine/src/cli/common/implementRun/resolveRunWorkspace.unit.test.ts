import { lstat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { contradictoryWorktreeFlagsMessage } from '#src/cli/common/constants/contradictoryWorktreeFlagsMessage.ts';
import { resolveRunWorkspace } from '#src/cli/common/implementRun/resolveRunWorkspace.ts';
import type { LightsoutConfig, RunLock, WorktreeOwner, WorktreeRecord } from '#src/contracts/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

// Mocked Imports
// -------------------------
// The worktree module is the seam every git command behind this resolver runs
// through, so mocking its barrel is what lets 'no git command ran' and 'nothing
// was created' be asserted at all. `resolveRunBranch` is deliberately NOT
// mocked: it is pure, and one row below turns on an input the real one refuses.
type WorktreeFailure = { error: string };

interface CreateParams {
	cwd: string;
	branch: string;
	startPoint: string;
	setup?: string;
	owner: WorktreeOwner;
	reuseExisting: boolean;
	onProgress?: (message: string) => void;
}

const mockCreateWorktree = jest.fn<(params: CreateParams) => Promise<string | WorktreeFailure>>();
const mockFetchDefaultBranch = jest.fn<(params: { cwd: string }) => Promise<string | WorktreeFailure>>();
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();

interface RecordParams {
	cwd: string;
	branch: string;
	owner: WorktreeOwner;
	worktreePath: string;
	startPoint?: string;
	onProgress?: (message: string) => void;
}

const mockResolveWorktreePath = jest.fn<(params: { cwd: string; branch: string }) => Promise<string>>();
const mockReadWorktreeRecord = jest.fn<(params: { cwd: string; branch: string }) => Promise<WorktreeRecord | undefined>>();
const mockWriteWorktreeRecord = jest.fn<(params: RecordParams) => Promise<void>>();
const mockPrepareTicketBranch = jest.fn<(params: { cwd: string; branch: string }) => Promise<{ startPoint?: string } | WorktreeFailure>>();

jest.mock('#src/worktree/index.ts', () => ({
	createWorktree: (params: CreateParams) => mockCreateWorktree(params),
	fetchDefaultBranch: (params: { cwd: string }) => mockFetchDefaultBranch(params),
	readBranchWorktree: (params: { cwd: string; branch: string }) => mockReadBranchWorktree(params),
	resolveWorktreePath: (params: { cwd: string; branch: string }) => mockResolveWorktreePath(params),
	readWorktreeRecord: (params: { cwd: string; branch: string }) => mockReadWorktreeRecord(params),
	writeWorktreeRecord: (params: RecordParams) => mockWriteWorktreeRecord(params),
	prepareWorkOrderBranch: (params: { cwd: string; branch: string }) => mockPrepareTicketBranch(params),
}));
// -------------------------
// The run lock of the ticket branch's own tree, which is what separates a tree
// an earlier implementation run finished with from one a run is still using.
const mockReadLiveRunLock = jest.fn<(params: { cwd: string }) => Promise<RunLock | undefined>>();

jest.mock('#src/runState/index.ts', () => ({
	readLiveRunLock: (params: { cwd: string }) => mockReadLiveRunLock(params),
}));
// -------------------------

const sourceCwd = resolve('/tmp/lightsout-launching-checkout');
const branch = 'lo-9-isolated-run';
const planPath = join('.lightsout', 'tickets', branch, 'plans');
const worktreePath = resolve('/tmp/lightsout-launching-checkout-worktrees', branch);
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
const pinnedCommit = '3f5c1a9e8b7d6c5b4a39281706f5e4d3c2b1a098';

/** The ownership record a tree at the branch's path carries, as the step that placed it there wrote it. */
const recordOwnedBy = ({ owner, startPoint }: { owner: WorktreeOwner; startPoint: string }): WorktreeRecord => ({
	branch,
	owner,
	worktreePath,
	createdAt: '2026-01-01T00:00:00.000Z',
	startPoint,
});

/** What the mocked worktree module answers this resolver back. */
interface Answers {
	/** The checkout already holding the branch, when a case is about one. */
	holder?: string;
	/** The ownership record at the branch's path, when a case is about one. */
	record?: WorktreeRecord;
	fetched?: string | WorktreeFailure;
	created?: string | WorktreeFailure;
}

/** A repo whose branch is free, whose remote answers, and whose tree is cut without complaint. */
const setupWorkspace = ({ worktree, setup, flags = [], answers = {} }: { worktree?: boolean; setup?: string; flags?: string[]; answers?: Answers } = {}) => {
	const { holder, record, fetched = 'main', created = worktreePath } = answers;

	mockFetchDefaultBranch.mockResolvedValue(fetched);
	mockReadBranchWorktree.mockResolvedValue(holder);
	mockResolveWorktreePath.mockResolvedValue(worktreePath);
	mockReadWorktreeRecord.mockResolvedValue(record);
	mockWriteWorktreeRecord.mockResolvedValue(undefined);
	mockCreateWorktree.mockResolvedValue(created);

	const config: LightsoutConfig = {
		gates,
		...(worktree === undefined ? {} : { implement: { worktree } }),
		...(setup === undefined ? {} : { worktree: { setup } }),
	};

	return { config, flags: new Map<string, string | true>(flags.map((name) => [name, true])) };
};

const ticketBranch = 'lo-7-search';
const ticketPlanPath = join('.lightsout', 'tickets', ticketBranch, 'plans', '002-ranking', 'plan.md');
const ticketWorktreePath = resolve('/tmp/lightsout-launching-checkout-worktrees', ticketBranch);
const pushedCommit = 'b91e40c27d3a85f6019c4ab7e2d3f5061a8c7b24';
const liveLock: RunLock = { pid: 4242, runId: 'run-2026-09-11-implement-002-ranking', startedAt: '2026-09-11T09:00:00.000Z' };

/** The ownership record the tree standing on a ticket branch carries, whichever step cut it. */
const ticketRecordOwnedBy = ({ owner }: { owner: WorktreeOwner }): WorktreeRecord => ({
	branch: ticketBranch,
	owner,
	worktreePath: ticketWorktreePath,
	createdAt: '2026-01-01T00:00:00.000Z',
	startPoint: pinnedCommit,
});

/**
 * A run whose `--plan` is a plan address, against a ticket branch standing
 * wherever the named answers put it. Separate from `setupWorkspace` because
 * every path here is keyed by the ticket branch rather than the plan's own
 * name, and two more seams — the ticket branch's state and the tree's run
 * lock — decide the answer.
 */
const setupTicketWorkspace = ({ holder, record, lock, startPoint }: { holder?: string; record?: WorktreeRecord; lock?: RunLock; startPoint?: string } = {}) => {
	mockPrepareTicketBranch.mockResolvedValue(startPoint === undefined ? {} : { startPoint });
	mockReadLiveRunLock.mockResolvedValue(lock);
	mockFetchDefaultBranch.mockResolvedValue('main');
	mockReadBranchWorktree.mockResolvedValue(holder);
	mockResolveWorktreePath.mockResolvedValue(ticketWorktreePath);
	mockReadWorktreeRecord.mockResolvedValue(record);
	mockWriteWorktreeRecord.mockResolvedValue(undefined);
	mockCreateWorktree.mockResolvedValue(ticketWorktreePath);

	const config: LightsoutConfig = { gates };

	return { config, flags: new Map<string, string | true>() };
};

/**
 * A run cutting a fresh tree, where the worktree step hands back a real empty
 * directory on disk. Separate from `setupWorkspace` because the claim is about
 * what the cut tree holds afterwards, which needs a tree something could
 * actually have written into.
 */
const setupCutWorkspace = async () => {
	const cutPath = await freshCwd();

	mockPrepareTicketBranch.mockResolvedValue({});
	mockFetchDefaultBranch.mockResolvedValue('main');
	mockReadBranchWorktree.mockResolvedValue(undefined);
	mockResolveWorktreePath.mockResolvedValue(cutPath);
	mockReadWorktreeRecord.mockResolvedValue(undefined);
	mockWriteWorktreeRecord.mockResolvedValue(undefined);
	mockCreateWorktree.mockResolvedValue(cutPath);

	const config: LightsoutConfig = { gates };

	return { config, flags: new Map<string, string | true>(), cutPath };
};

describe('resolveRunWorkspace', () => {
	test('refuses both worktree flags together before running any git command', async () => {
		const { config, flags } = setupWorkspace({ flags: ['worktree', 'no-worktree'] });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toStrictEqual({ error: contradictoryWorktreeFlagsMessage });
		expect(mockReadBranchWorktree).not.toHaveBeenCalled();
		expect(mockFetchDefaultBranch).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('builds in the launching checkout when implement.worktree is false', async () => {
		const { config, flags } = setupWorkspace({ worktree: false });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ cwd: sourceCwd, isolated: false, created: false }));
		expect(mockFetchDefaultBranch).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('the worktree flag overrides a configuration that turned isolation off', async () => {
		const { config, flags } = setupWorkspace({ worktree: false, flags: ['worktree'] });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ cwd: worktreePath, branch, isolated: true, created: true }));
	});

	test('never refuses a run building in the launching checkout over a branch it does not need', async () => {
		const { config, flags } = setupWorkspace({ flags: ['no-worktree'] });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath: join('docs', '!!!.md') });

		expect(workspace).toEqual(expect.objectContaining({ cwd: sourceCwd, isolated: false }));
	});

	test('isolates by default when nothing states a preference', async () => {
		const { config, flags } = setupWorkspace();

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ cwd: worktreePath, branch, isolated: true }));
	});

	test('refuses a branch already checked out and names the checkout holding it', async () => {
		const holder = resolve('/tmp/somebody-elses-checkout');
		const { config, flags } = setupWorkspace({ answers: { holder } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining(holder) });
		expect(workspace).toEqual({ error: expect.stringContaining('--no-worktree') });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('stops when the default-branch fetch fails', async () => {
		const { config, flags } = setupWorkspace({ answers: { fetched: { error: 'git could not fetch origin: no remote named origin' } } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining('git could not fetch origin: no remote named origin') });
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('never falls back to the launching checkout when creation fails', async () => {
		const { config, flags } = setupWorkspace({ answers: { created: { error: `git could not create a worktree for '${branch}': fatal: invalid reference` } } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining(`git could not create a worktree for '${branch}': fatal: invalid reference`) });
	});

	test('stops on a failed setup rather than building in an unprepared tree', async () => {
		const { config, flags } = setupWorkspace({ setup: 'pnpm install', answers: { created: { error: `the setup command failed in ${worktreePath}: exit 1` } } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining(`the setup command failed in ${worktreePath}`) });
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ setup: 'pnpm install' }));
	});

	test("claims the tree as an implement run's and refuses to reuse one", async () => {
		const { config, flags } = setupWorkspace();

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual(expect.objectContaining({ isolated: true, created: true }));
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch, owner: 'implement', reuseExisting: false }));
	});

	test('continues in the tree planning established and takes ownership of it', async () => {
		const { config, flags } = setupWorkspace({
			setup: 'pnpm install',
			answers: { holder: worktreePath, record: recordOwnedBy({ owner: 'plan', startPoint: pinnedCommit }) },
		});

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toStrictEqual({ cwd: worktreePath, branch, isolated: true, created: false });
		expect(mockWriteWorktreeRecord).toHaveBeenCalledWith(expect.objectContaining({ branch, owner: 'implement', worktreePath, startPoint: pinnedCommit }));
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test.each([{ record: recordOwnedBy({ owner: 'queue', startPoint: 'origin/main' }) }, { record: undefined }])(
		'still refuses a tree planning never recorded',
		async ({ record }) => {
			const { config, flags } = setupWorkspace({ answers: { holder: worktreePath, record } });

			const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

			expect(workspace).toEqual({ error: expect.stringContaining(worktreePath) });
			expect(workspace).toEqual({ error: expect.stringContaining('--no-worktree') });
			expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
			expect(mockCreateWorktree).not.toHaveBeenCalled();
		},
	);

	test('continues a plan address in the ticket tree an earlier implementation run adopted', async () => {
		const { config, flags } = setupTicketWorkspace({ holder: ticketWorktreePath, record: ticketRecordOwnedBy({ owner: 'implement' }) });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath: ticketPlanPath });

		expect(workspace).toStrictEqual({ cwd: ticketWorktreePath, branch: ticketBranch, isolated: true, created: false });
		expect(mockWriteWorktreeRecord).toHaveBeenCalledWith(
			expect.objectContaining({ branch: ticketBranch, owner: 'implement', worktreePath: ticketWorktreePath, startPoint: pinnedCommit }),
		);
		expect(mockFetchDefaultBranch).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test("refuses a plan address while a live run holds the ticket tree's run lock, naming the run", async () => {
		const { config, flags } = setupTicketWorkspace({ holder: ticketWorktreePath, record: ticketRecordOwnedBy({ owner: 'plan' }), lock: liveLock });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath: ticketPlanPath });

		expect(workspace).toEqual({ error: expect.stringContaining(ticketWorktreePath) });
		expect(workspace).toEqual({ error: expect.stringContaining(liveLock.runId) });
		expect(workspace).toEqual({ error: expect.stringContaining('--no-worktree') });
		expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
		expect(mockCreateWorktree).not.toHaveBeenCalled();
	});

	test('a legacy plan never adopts a tree an implementation run already owns', async () => {
		const { config, flags } = setupWorkspace({ answers: { holder: worktreePath, record: recordOwnedBy({ owner: 'implement', startPoint: pinnedCommit }) } });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		expect(workspace).toEqual({ error: expect.stringContaining(worktreePath) });
		expect(workspace).toEqual({ error: expect.stringContaining('--no-worktree') });
		expect(mockWriteWorktreeRecord).not.toHaveBeenCalled();
		expect(mockReadLiveRunLock).not.toHaveBeenCalled();
	});

	test('builds a later plan on the pushed ticket branch when only the remote holds it', async () => {
		const { config, flags } = setupTicketWorkspace({ startPoint: pushedCommit });

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath: ticketPlanPath });

		expect(workspace).toEqual(expect.objectContaining({ cwd: ticketWorktreePath, branch: ticketBranch, isolated: true, created: true }));
		expect(mockCreateWorktree).toHaveBeenCalledWith(expect.objectContaining({ branch: ticketBranch, startPoint: pushedCommit, owner: 'implement' }));
	});

	test('resolveRunWorkspace: leaves the cut worktree carrying no record symlinks', async () => {
		const { config, flags, cutPath } = await setupCutWorkspace();

		const workspace = await resolveRunWorkspace({ cwd: sourceCwd, config, flags, planPath });

		const standing = {
			runs: await lstat(join(cutPath, '.lightsout', 'runs')).catch(() => undefined),
			ship: await lstat(join(cutPath, '.lightsout', 'ship')).catch(() => undefined),
			friction: await lstat(join(cutPath, '.lightsout', 'friction.jsonl')).catch(() => undefined),
			findings: await lstat(join(cutPath, '.lightsout', 'review-findings.jsonl')).catch(() => undefined),
		};
		const entries = await readdir(cutPath);

		expect(workspace).toStrictEqual({ cwd: cutPath, branch, isolated: true, created: true });
		expect(standing).toStrictEqual({ runs: undefined, ship: undefined, friction: undefined, findings: undefined });
		expect(entries).toStrictEqual([]);
	});
});
