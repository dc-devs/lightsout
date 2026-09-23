import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import {
	type LightsoutConfig,
	PlanProgress,
	type RunLock,
	WorkOrderEventKind,
	WorkOrderMode,
	type WorkOrderPlan,
	type WorkOrderState,
} from '#src/contracts/index.ts';
import type { GateRunResult } from '#src/gates/index.ts';
import { excludeWorkOrderPlan, setWorkOrderMode, updateLocalWorkOrderState } from '#src/workOrder/index.ts';

// Mocked Imports
// -------------------------
// The four boundaries a branch verification runs through — which checkout holds
// the branch, what it has uncommitted, which run is editing it, and what its own
// gates say — are the seams. Mocking them is what lets 'no gate ran at all' and
// 'this exact commit was the verified one' be asserted. The record itself is a
// real file in a temporary checkout, because what this function promises is
// about which bytes reach disk.
interface GateParams {
	cwd: string;
	config: LightsoutConfig;
	coverage?: boolean;
	includeRoot?: boolean;
	onProgress?: (message: string) => void;
}

const mockRunGates = jest.fn<(params: GateParams) => Promise<GateRunResult>>();

jest.mock('#src/gates/index.ts', () => ({ runGates: (params: GateParams) => mockRunGates(params) }));
// -------------------------
const mockReadBranchWorktree = jest.fn<(params: { cwd: string; branch: string }) => Promise<string | undefined>>();

jest.mock('#src/worktree/index.ts', () => ({ readBranchWorktree: (params: { cwd: string; branch: string }) => mockReadBranchWorktree(params) }));
// -------------------------
const mockReadLiveRunLock = jest.fn<(params: { cwd: string }) => Promise<RunLock | undefined>>();

jest.mock('#src/runState/index.ts', () => ({ readLiveRunLock: (params: { cwd: string }) => mockReadLiveRunLock(params) }));
// -------------------------
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({ readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params) }));
// -------------------------
const mockReadGitHeadCommit = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/common/git/readGitHeadCommit.ts', () => ({ readGitHeadCommit: (params: { cwd: string }) => mockReadGitHeadCommit(params) }));
// -------------------------
const mockReadConfig = jest.fn<(params: { cwd: string }) => Promise<LightsoutConfig>>();

jest.mock('#src/common/config/readConfig.ts', () => ({ readConfig: (params: { cwd: string }) => mockReadConfig(params) }));
// -------------------------

/** The work order's label: the folder every record below sits in, and the name every remedy takes. */
const name = 'lo-140-multi';
const firstPlan = '001-record';
const secondPlan = '002-queue-order';
/** The checkout that holds the ticket branch, which every refusal about the branch names. */
const checkout = '/repo/.worktrees/lo-140-multi';
const headCommit = '9f1c0a7d3b6e4152a8c07d5b9e2f4a6c1d3e5f70';
const gates: LightsoutConfig['gates'] = { check: 'true', test: 'true', 'test-coverage': false };
/** No `ticket-tracker` block: this machine's record is the only copy, so no publish is in play. */
const config: LightsoutConfig = { gates };
/** The ticket branch's OWN config, which the verification reads from that checkout rather than from `cwd`. */
const checkoutConfig: LightsoutConfig = { gates: { check: 'pnpm check', test: 'pnpm test', 'test-coverage': 'pnpm coverage' } };
const env: NodeJS.ProcessEnv = {};

const planOf = ({ id, progress, exclusion }: { id: string; progress: PlanProgress; exclusion?: WorkOrderPlan['exclusion'] }): WorkOrderPlan => ({
	id,
	title: `plan ${id}`,
	progress,
	createdAt: '2026-01-01T00:00:00.000Z',
	exclusion,
});

const recordOf = ({
	mode,
	plans,
	shipRequest,
}: {
	mode: WorkOrderMode;
	plans: WorkOrderPlan[];
	shipRequest?: { planIds: string[]; requestedAt: string };
}): WorkOrderState => ({
	schemaVersion: 1,
	name,
	ticketRef: 'LO-140',
	// The branch carries a prefix the label does not, so every `--name` value and
	// every history detail below can only read as the label it names.
	branch: `feature/${name}`,
	mode,
	plans,
	shipRequest,
	history: [{ at: '2026-01-01T00:00:00.000Z', kind: WorkOrderEventKind.PlanAdded, detail: `added plan ${firstPlan}` }],
});

interface ExclusionSetup {
	mode?: WorkOrderMode;
	plans?: WorkOrderPlan[];
	/** A ship request already pending on the ticket. */
	shipRequest?: { planIds: string[]; requestedAt: string };
	/** The checkout holding the ticket branch, or undefined when none does. */
	worktree?: string;
	/** What that checkout has modified or untracked, or undefined when its git status cannot be read at all. */
	changed?: string[];
	/** The commit that checkout stands on, or undefined when it cannot be read. */
	head?: string;
	/** The run editing that checkout right now, or undefined when nothing is. */
	liveLock?: RunLock;
	/** The sentence the checkout's own gates fail with. */
	gateError?: string;
}

const setupExclusion = async (setup: ExclusionSetup = {}) => {
	const {
		mode = WorkOrderMode.MultiplePlan,
		plans = [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Planning })],
		shipRequest,
		liveLock,
		gateError,
	} = setup;
	// Read through the key rather than a destructuring default, so a row that
	// says `worktree: undefined` gets no checkout at all — a default would hand
	// it the checkout back and the row could never reach the refusal it names.
	const worktree = 'worktree' in setup ? setup.worktree : checkout;
	// The same reason for both of these: `undefined` is the unreadable answer
	// each of them has, and a default would swallow a row that asks for it.
	const changed = 'changed' in setup ? setup.changed : [];
	const head = 'head' in setup ? setup.head : headCommit;
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-exclude-plan-'));

	await updateLocalWorkOrderState({ cwd, name, change: () => recordOf({ mode, plans, shipRequest }) });

	mockReadBranchWorktree.mockResolvedValue(worktree);
	mockReadLiveRunLock.mockResolvedValue(liveLock);
	mockReadGitChangedFiles.mockResolvedValue(changed);
	mockReadGitHeadCommit.mockResolvedValue(head);
	mockReadConfig.mockResolvedValue(checkoutConfig);
	mockRunGates.mockResolvedValue({ error: gateError, failedFamilies: gateError === undefined ? [] : ['test'], crashes: [], coordination: undefined });

	const recordPath = join(cwd, '.lightsout', 'work-orders', name, 'state.json');

	return { recordPath, before: readFileSync(recordPath, 'utf8'), base: { cwd, name, config, env } };
};

const recordAt = ({ recordPath }: { recordPath: string }) => JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState;

const exclusionAt = ({ recordPath, id }: { recordPath: string; id: string }) => recordAt({ recordPath }).plans.find((plan) => plan.id === id)?.exclusion;

/** The refusal sentence, or an empty string when the call did not refuse — so a missing refusal fails the assertion rather than the type check. */
const errorOf = ({ result }: { result: { error: string } | { record: WorkOrderState } }) => ('error' in result ? result.error : '');

describe('excludeWorkOrderPlan', () => {
	test('excludes a plan whose implementation never started without verifying the branch', async () => {
		const { base, recordPath } = await setupExclusion();

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'superseded by plan 003', implementationRemoved: false });

		expect(result).not.toHaveProperty('error');
		const exclusion = exclusionAt({ recordPath, id: secondPlan });

		expect(typeof exclusion?.at).toBe('string');
		// The rest is compared whole, so a `verifiedCommit` recorded for a plan
		// nothing was verified about fails here rather than passing as an extra key.
		expect({ ...exclusion, at: undefined }).toStrictEqual({
			at: undefined,
			reason: 'superseded by plan 003',
			implementationRemoved: false,
		});
		expect(mockRunGates).not.toHaveBeenCalled();
	});

	test('withdraws a pending ship request that names the excluded plan', async () => {
		const { base, recordPath } = await setupExclusion({ shipRequest: { planIds: [firstPlan, secondPlan], requestedAt: '2026-02-01T00:00:00.000Z' } });

		const result = await excludeWorkOrderPlan({ ...base, plan: secondPlan, reason: 'not needed after all', implementationRemoved: false });

		const record = recordAt({ recordPath });

		expect(result).toEqual(expect.objectContaining({ notice: expect.stringContaining('ship request') }));
		expect(record.shipRequest).toBeUndefined();
		// The exclusion is recorded first and the withdrawal it caused second, so
		// the history reads as one following from the other.
		expect(record.history.slice(-2)).toEqual([
			// the exclusion is recorded against the work order's label, never
			// against the prefixed branch its plans implement on
			expect.objectContaining({ kind: WorkOrderEventKind.PlanExcluded, detail: expect.stringContaining(`excluded from work order ${name}:`) }),
			expect.objectContaining({ kind: WorkOrderEventKind.ShipRequestWithdrawn, detail: expect.stringContaining(secondPlan) }),
		]);
		expect(record.history.at(-1)?.detail).toContain('not needed after all');
	});

	test("records the verified commit when the ticket branch's checkout is clean and its full gates pass", async () => {
		const { base, recordPath } = await setupExclusion({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Implemented }), planOf({ id: secondPlan, progress: PlanProgress.Implemented })],
		});

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'implementation removed with the agent', implementationRemoved: true });

		expect(result).not.toHaveProperty('error');
		// The same full run ship's integration makes: the checkout's own config,
		// coverage on and the whole repository included.
		expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ cwd: checkout, config: checkoutConfig, coverage: true, includeRoot: true }));
		const exclusion = exclusionAt({ recordPath, id: secondPlan });

		expect(typeof exclusion?.at).toBe('string');
		expect({ ...exclusion, at: undefined }).toStrictEqual({
			at: undefined,
			reason: 'implementation removed with the agent',
			implementationRemoved: true,
			verifiedCommit: headCommit,
		});
	});

	test("refuses the exclusion and changes nothing when the branch's gates fail", async () => {
		const { base, recordPath, before } = await setupExclusion({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Implemented }), planOf({ id: secondPlan, progress: PlanProgress.Implemented })],
			gateError: 'test: 3 suites failed',
		});

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'implementation removed with the agent', implementationRemoved: true });

		// The gate's own output has to reach the human, or the refusal says the
		// branch is unverified without saying what was red.
		expect(errorOf({ result })).toContain('test: 3 suites failed');
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test("refuses a started plan's exclusion while the ticket branch's checkout has uncommitted changes", async () => {
		const { base, recordPath, before } = await setupExclusion({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Implementing })],
			changed: ['src/workOrder/leftover.ts'],
		});

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'abandoned', implementationRemoved: true });

		expect(errorOf({ result })).toContain(checkout);
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test("refuses a started plan's exclusion when no checkout holds the ticket branch", async () => {
		const { base, recordPath, before } = await setupExclusion({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Failed })],
			worktree: undefined,
		});

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'replaced by plan 003', implementationRemoved: true });

		// the one sentence here genuinely about a git branch names the branch, prefix and all, rather than the work order's label
		expect(errorOf({ result })).toContain(`feature/${name}`);
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test("refuses a started plan's exclusion while a live run holds the ticket branch's checkout", async () => {
		const { base, recordPath, before } = await setupExclusion({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Implementing })],
			liveLock: { pid: 4242, runId: 'run-9c2a', startedAt: '2026-02-01T00:00:00.000Z' },
		});

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'abandoned', implementationRemoved: true });

		const error = errorOf({ result });

		// A gate run beside a live implementation run would verify a tree that is
		// still changing, so the recorded commit would prove nothing.
		expect(error).toContain('run-9c2a');
		expect(error).toContain(checkout);
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test("refuses a started plan's exclusion when the checkout's git status or its commit cannot be read", async () => {
		const startedPlans = [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Implemented })];
		const noStatus = await setupExclusion({ plans: startedPlans, changed: undefined });
		// An unreadable HEAD only shows up after the clean check, so this row also
		// proves the verification stops before it records an exclusion with no commit.
		const noHead = await setupExclusion({ plans: startedPlans, head: undefined });

		const afterNoStatus = await excludeWorkOrderPlan({ ...noStatus.base, plan: '2', reason: 'code removed', implementationRemoved: true });
		const afterNoHead = await excludeWorkOrderPlan({ ...noHead.base, plan: '2', reason: 'code removed', implementationRemoved: true });

		expect(errorOf({ result: afterNoStatus })).toContain(checkout);
		expect(errorOf({ result: afterNoHead })).toContain(checkout);
		expect(exclusionAt({ recordPath: noStatus.recordPath, id: secondPlan })).toBeUndefined();
		expect(exclusionAt({ recordPath: noHead.recordPath, id: secondPlan })).toBeUndefined();
		expect(mockRunGates).not.toHaveBeenCalled();
	});

	test('refuses to exclude a plan that is already excluded', async () => {
		const pendingRemoval: WorkOrderPlan['exclusion'] = { at: '2026-01-05T00:00:00.000Z', reason: 'the first reason', implementationRemoved: false };
		const recordedRemoval: WorkOrderPlan['exclusion'] = {
			at: '2026-01-05T00:00:00.000Z',
			reason: 'the first reason',
			implementationRemoved: true,
			verifiedCommit: 'c0ffee1234567890c0ffee1234567890c0ffee12',
		};

		// The only two calls an existing exclusion can take: a plain second
		// exclusion, and a removal on one that already records a removal.
		for (const { exclusion, implementationRemoved, progress } of [
			{ exclusion: pendingRemoval, implementationRemoved: false, progress: PlanProgress.Planning },
			{ exclusion: recordedRemoval, implementationRemoved: true, progress: PlanProgress.Implemented },
		]) {
			const { base, recordPath, before } = await setupExclusion({
				plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress, exclusion })],
			});

			const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'a second reason', implementationRemoved });

			expect(errorOf({ result })).toContain(`already excluded from work order ${name}`);
			expect(exclusionAt({ recordPath, id: secondPlan })).toStrictEqual(exclusion);
			expect(readFileSync(recordPath, 'utf8')).toBe(before);
		}
	});

	test('records a verified removal on an existing exclusion so the ticket can return to single-plan mode', async () => {
		const original: WorkOrderPlan['exclusion'] = { at: '2026-01-05T00:00:00.000Z', reason: 'superseded, code removed by hand', implementationRemoved: false };
		const { base, recordPath } = await setupExclusion({
			plans: [
				planOf({ id: firstPlan, progress: PlanProgress.Implemented }),
				planOf({ id: secondPlan, progress: PlanProgress.Implemented, exclusion: original }),
			],
		});

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'a reason the record keeps out', implementationRemoved: true });

		// The second call is the point of the first: recording the verified removal
		// is what reopens the way back to single-plan mode.
		const switched = await setWorkOrderMode({ ...base, mode: WorkOrderMode.SinglePlan, approve: false });

		expect(result).not.toHaveProperty('error');
		expect(exclusionAt({ recordPath, id: secondPlan })).toStrictEqual({
			at: '2026-01-05T00:00:00.000Z',
			reason: 'superseded, code removed by hand',
			implementationRemoved: true,
			verifiedCommit: headCommit,
		});
		expect(recordAt({ recordPath }).history.filter((event) => event.kind === WorkOrderEventKind.PlanExcluded)).toHaveLength(1);
		// the removal is recorded against the label too, beside the commit that verified it
		expect(recordAt({ recordPath }).history.find((event) => event.kind === WorkOrderEventKind.PlanExcluded)?.detail).toContain(
			`removed from work order ${name}, verified at ${headCommit}`,
		);
		expect(switched).not.toHaveProperty('error');
		expect(recordAt({ recordPath }).mode).toBe(WorkOrderMode.SinglePlan);
	});

	test('refuses to exclude plan 001 in single-plan mode', async () => {
		const { base, recordPath, before } = await setupExclusion({
			mode: WorkOrderMode.SinglePlan,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
		});

		const result = await excludeWorkOrderPlan({ ...base, plan: '1', reason: 'no longer wanted', implementationRemoved: false });

		expect(result).toHaveProperty('error');
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses --implementation-removed for a plan whose implementation never started', async () => {
		const { base, recordPath, before } = await setupExclusion();

		const result = await excludeWorkOrderPlan({ ...base, plan: '2', reason: 'never built', implementationRemoved: true });

		expect(errorOf({ result })).toContain(`on work order ${name} has no implementation to remove`);
		expect(mockRunGates).not.toHaveBeenCalled();
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('excludeWorkOrderPlan refusals and notices spell the work-order command word', async () => {
		const singlePlan = await setupExclusion({ mode: WorkOrderMode.SinglePlan, plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })] });
		// A started plan, so the withdrawal rides on the verified-removal path the
		// criterion names rather than on the plain exclusion the row above covers.
		const started = await setupExclusion({
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Implemented }), planOf({ id: secondPlan, progress: PlanProgress.Implemented })],
			shipRequest: { planIds: [firstPlan, secondPlan], requestedAt: '2026-02-01T00:00:00.000Z' },
		});

		const refused = await excludeWorkOrderPlan({ ...singlePlan.base, plan: '1', reason: 'no longer wanted', implementationRemoved: false });
		const withdrawn = await excludeWorkOrderPlan({ ...started.base, plan: '2', reason: 'implementation removed with the agent', implementationRemoved: true });

		const refusal = errorOf({ result: refused });
		const notice = 'error' in withdrawn ? undefined : withdrawn.notice;

		expect(refusal).toContain(`lightsout work-order mode --name ${name} --set multiple-plan`);
		expect(notice).toContain(`lightsout work-order request-ship --name ${name}`);
		// `--name` takes the label, so a remedy naming the prefixed branch is one nothing accepts
		expect(`${refusal}\n${notice ?? ''}`).not.toContain('feature/');
		// The old command word anywhere in either sentence is the failure this row
		// exists for, so both are checked for it rather than only for the new one.
		expect(refusal).not.toContain('lightsout ticket ');
		expect(notice).not.toContain('lightsout ticket ');
	});
});
