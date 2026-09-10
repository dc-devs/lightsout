import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { type RunManifest, RunStatus, type StepRecord } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// `watchRunProgress` owns a two-minute repaint clock this command never sets and
// its own test drives directly; what belongs here is whether the command reaches
// for it, and with which family. Everything else — the manifests, the locks, the
// target resolution, the rendering — is real.
const mockWatchRunProgress = jest.fn<(params: { cwd: string; runId?: string; rootRunId?: string }) => Promise<void>>();

jest.mock('#src/cli/common/utils/watchRunProgress.ts', () => ({
	watchRunProgress: (params: { cwd: string; runId?: string; rootRunId?: string }) => mockWatchRunProgress(params),
}));
// -------------------------

/** Beyond any OS pid range — the live-process probe reports it dead. */
const deadPid = 999_999_999;

const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId: 'run-single',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:03.000Z',
	plan: 'plans/demo.md',
	harness: 'claude-code',
	status: RunStatus.Failed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
	...overrides,
});

const stepOf = (overrides: Partial<StepRecord> = {}): StepRecord => ({
	id: 'phase1.md',
	status: RunStatus.Passed,
	attempts: 1,
	...overrides,
});

/**
 * status renders whatever run state is on disk, so the arrangement is real
 * manifests (and a real `.lightsout/lock.json`) in a temp repo — read back
 * through the same readers the CLI uses, never stubbed.
 */
const setupStatus = ({
	manifests = [],
	lock,
	unreadableRunId,
	withoutRunsDir = false,
}: {
	manifests?: RunManifest[];
	lock?: { pid: number; runId: string };
	unreadableRunId?: string;
	withoutRunsDir?: boolean;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-status-command-'));

	if (!withoutRunsDir) {
		mkdirSync(join(cwd, '.lightsout', 'runs'), { recursive: true });
	}

	for (const manifest of manifests) {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest));
	}

	if (unreadableRunId) {
		mkdirSync(join(cwd, '.lightsout', 'runs', unreadableRunId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', unreadableRunId, 'manifest.json'), 'not json at all');
	}

	if (lock) {
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ ...lock, startedAt: '2026-01-01T00:00:01.000Z' }));
	}

	return { context: { flags: new Map<string, string | true>(), rest: [], cwd }, ...captured };
};

/** A phased sequence stopped mid-phase: phase 1 done, phase 2 in flight under child run `run-child`. */
const runningSequence = (overrides: Partial<StepRecord> = {}): RunManifest =>
	manifestOf({
		runId: 'run-seq',
		pipeline: 'phases',
		plan: 'plans/demo/overview.md',
		status: RunStatus.Running,
		currentStep: 'phase2.md',
		steps: [
			stepOf({ id: 'phase1.md' }),
			stepOf({ id: 'phase2.md', status: RunStatus.Running, report: { runId: 'run-child' }, ...overrides }),
			stepOf({ id: 'phase3.md', status: RunStatus.Pending, attempts: 0 }),
		],
	});

/**
 * A checkout of its own holding a live lock naming one run — where an isolated
 * run's process actually takes the per-checkout lock, while the run's records
 * stay in the checkout the command was launched from.
 */
const workspaceHoldingLock = ({ runId }: { runId: string }) => {
	const workspace = mkdtempSync(join(tmpdir(), 'lightsout-status-workspace-'));

	mkdirSync(join(workspace, '.lightsout'), { recursive: true });
	writeFileSync(join(workspace, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId, startedAt: '2026-01-01T00:00:01.000Z' }));

	return workspace;
};

/** Running isolated runs, one workspace each, in a launching checkout that holds no lock of its own. */
const setupIsolatedRuns = ({ runIds, args = {} }: { runIds: string[]; args?: Record<string, string | true> }) => {
	mockWatchRunProgress.mockResolvedValue(undefined);

	const manifests = runIds.map((runId) => manifestOf({ runId, status: RunStatus.Running, workspace: workspaceHoldingLock({ runId }) }));
	const { context, ...captured } = setupStatus({ manifests });

	return { context: { ...context, flags: new Map<string, string | true>(Object.entries(args)) }, ...captured };
};

/** Three hours, which is how long ago the run below last wrote its manifest. */
const threeHoursMs = 10_800_000;

/**
 * One `running` run opened with `--run`, its records three hours cold, either
 * holding its lock in a recorded workspace or nowhere at all. The block's clock
 * is what a live run and a stopped one differ by: the running step of a live run
 * shows its persisted total plus the time since that last write, and a run with
 * no process behind it shows the persisted number unchanged.
 */
const setupIsolatedProgress = ({ isolated }: { isolated: boolean }) => {
	const runId = 'run-iso';
	const lastWrite = new Date(Date.now() - threeHoursMs).toISOString();
	const manifest = manifestOf({
		runId,
		createdAt: lastWrite,
		updatedAt: lastWrite,
		status: RunStatus.Running,
		currentStep: 'implement',
		steps: [stepOf({ id: 'implement', status: RunStatus.Running })],
		...(isolated ? { workspace: workspaceHoldingLock({ runId }) } : {}),
	});
	const { context, ...captured } = setupStatus({ manifests: [manifest] });

	return { context: { ...context, flags: new Map<string, string | true>([['run', runId]]) }, ...captured };
};

describe('statusCommand', () => {
	test.each([
		{ label: 'a repo that never ran anything', withoutRunsDir: true },
		{ label: 'an empty runs directory', withoutRunsDir: false },
	])('reports no runs for $label and exits 0', async ({ withoutRunsDir }) => {
		const { context, logged, errors, exitCodes } = setupStatus({ withoutRunsDir });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['no runs found']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a single-plan run lists its id, status, plan and last update — no phase counter on a line that has no phases', async () => {
		const { context, logged, errors, exitCodes } = setupStatus({ manifests: [manifestOf()] });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-single  failed  plan: plans/demo.md  updated: 2026-01-01T00:00:03.000Z']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a run built from a ticket names that ticket, so parked queue work is findable from the run list alone', async () => {
		const { context, logged, exitCodes } = setupStatus({
			manifests: [manifestOf({ runId: 'run-direct', pipeline: 'direct', plan: '.lightsout/runs/run-direct/ticket.md', ticketRef: 'LO-70' })],
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-direct  failed  plan: .lightsout/runs/run-direct/ticket.md  ticket: LO-70  updated: 2026-01-01T00:00:03.000Z']);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a phased run counts its passed phases against the total, between the plan and the update time', async () => {
		const { context, logged, exitCodes } = setupStatus({
			manifests: [
				manifestOf({
					runId: 'run-seq',
					pipeline: 'phases',
					plan: 'plans/demo/overview.md',
					status: RunStatus.Failed,
					steps: [
						stepOf({ id: 'phase1.md' }),
						stepOf({ id: 'phase2.md', status: RunStatus.Failed }),
						stepOf({ id: 'phase3.md', status: RunStatus.Pending, attempts: 0 }),
					],
				}),
			],
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-seq  failed  plan: plans/demo/overview.md  phases: 1/3  updated: 2026-01-01T00:00:03.000Z']);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a finished sequence counts every phase as passed', async () => {
		const { context, logged } = setupStatus({
			manifests: [
				manifestOf({
					runId: 'run-seq',
					pipeline: 'phases',
					plan: 'plans/demo/overview.md',
					status: RunStatus.Passed,
					steps: [stepOf({ id: 'phase1.md' }), stepOf({ id: 'phase2.md' })],
				}),
			],
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-seq  passed  plan: plans/demo/overview.md  phases: 2/2  updated: 2026-01-01T00:00:03.000Z']);
	});

	test('a running sequence whose phase holds the repo lock under the child run id reads as healthy, not as a crash', async () => {
		const { context, logged, exitCodes } = setupStatus({ manifests: [runningSequence()], lock: { pid: process.pid, runId: 'run-child' } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-seq  running  plan: plans/demo/overview.md  phases: 1/3  updated: 2026-01-01T00:00:03.000Z']);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a running sequence holding the lock under its own id reads as healthy — the moment between two phases', async () => {
		const { context, logged } = setupStatus({ manifests: [runningSequence()], lock: { pid: process.pid, runId: 'run-seq' } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-seq  running  plan: plans/demo/overview.md  phases: 1/3  updated: 2026-01-01T00:00:03.000Z']);
	});

	test.each([
		{ label: 'the lock names a run that is neither the sequence nor its child', step: {}, lockRunId: 'run-stranger' },
		{ label: 'the running phase records no child run yet', step: { report: undefined }, lockRunId: 'run-child' },
		{ label: 'the running phase report is not a phase report', step: { report: { note: 'not a run id' } }, lockRunId: 'run-child' },
	])('a running sequence is reported as a resumable crash when $label', async ({ step, lockRunId }) => {
		const { context, logged, exitCodes } = setupStatus({ manifests: [runningSequence(step)], lock: { pid: process.pid, runId: lockRunId } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0] ?? '').toMatch(/^run-seq {2}running \(no live process/);
		expect(logged[0] ?? '').toMatch(/resume with --run run-seq/);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a running sequence with no phase in flight is a crash leftover when the lock belongs to another run', async () => {
		const sequence = runningSequence();
		const { context, logged } = setupStatus({
			manifests: [manifestOf({ ...sequence, steps: sequence.steps.map((step) => ({ ...step, status: RunStatus.Passed })) })],
			lock: { pid: process.pid, runId: 'run-stranger' },
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0] ?? '').toMatch(/no live process/);
	});

	test('a running single-plan run is a crash leftover when the lock belongs to another run, whatever its steps say', async () => {
		const { context, logged } = setupStatus({
			manifests: [
				manifestOf({
					status: RunStatus.Running,
					currentStep: 'implement',
					steps: [stepOf({ id: 'implement', status: RunStatus.Running, report: { runId: 'run-child' } })],
				}),
			],
			lock: { pid: process.pid, runId: 'run-child' },
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		// the child-lock allowance is for phased runs only — nothing else borrows another run's lock
		expect(logged[0] ?? '').toMatch(/^run-single {2}running \(no live process/);
	});

	test.each([
		{ label: 'the lock names a dead process', lock: { pid: deadPid, runId: 'run-child' } },
		{ label: 'no lock file exists at all', lock: undefined },
	])('a running sequence with nothing alive behind the lock is a resumable crash when $label', async ({ lock }) => {
		const { context, logged } = setupStatus({ manifests: [runningSequence()], lock });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0] ?? '').toMatch(/^run-seq {2}running \(no live process/);
	});

	test('a run whose manifest cannot be read is skipped, and the rest still list', async () => {
		const { context, logged, errors, exitCodes } = setupStatus({ manifests: [manifestOf()], unreadableRunId: 'corrupt-run' });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-single  failed  plan: plans/demo.md  updated: 2026-01-01T00:00:03.000Z']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a healthy isolated run is listed as running rather than as a crash leftover', async () => {
		const { context, logged, errors, exitCodes } = setupIsolatedRuns({ runIds: ['run-iso'] });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-iso  running  plan: plans/demo.md  updated: 2026-01-01T00:00:03.000Z']);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('an isolated run opened with --run has a block whose clock ticks, because its holder is found in the workspace it recorded', async () => {
		const { context, logged, errors, exitCodes } = setupIsolatedProgress({ isolated: true });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.some((line) => line.startsWith(' elapsed 180m'))).toBe(true);
		expect(logged.some((line) => /^ ▶ {2}implement +running +180m/.test(line))).toBe(true);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('the same run with no recorded workspace and no holder anywhere has a block frozen at the time it last wrote', async () => {
		const { context, logged, exitCodes } = setupIsolatedProgress({ isolated: false });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain(' elapsed 0m 00s · 0 files');
		expect(logged.some((line) => /^ ▶ {2}implement +running +0m 00s/.test(line))).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a bare --watch with several runs going names the ids and exits 1 without painting a block', async () => {
		const { context, logged, errors, exitCodes } = setupIsolatedRuns({ runIds: ['run-alpha', 'run-beta'], args: { watch: true } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toMatch(/run-alpha[\s\S]*run-beta|run-beta[\s\S]*run-alpha/);
		expect(errors.join('\n')).toMatch(/--run/);
		expect(logged).toStrictEqual([]);
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a bare --watch with one run going follows it rather than asking which', async () => {
		const { context, errors, exitCodes } = setupIsolatedRuns({ runIds: ['run-solo'], args: { watch: true } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockWatchRunProgress).toHaveBeenCalledWith({ cwd: context.cwd, rootRunId: 'run-solo' });
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});
});
