import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { RunStatus, type RunManifest, type StepRecord } from '@/contracts';
import { statusCommand } from '@/cli/statusCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';

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

describe('statusCommand', () => {
	test.each([{ label: 'a repo that never ran anything', withoutRunsDir: true }, { label: 'an empty runs directory', withoutRunsDir: false }])(
		'reports no runs for $label and exits 0',
		async ({ withoutRunsDir }) => {
			const { context, logged, errors, exitCodes } = setupStatus({ withoutRunsDir });

			await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

			expect(logged).toStrictEqual(['no runs found']);
			expect(errors).toStrictEqual([]);
			expect(exitCodes).toStrictEqual([0]);
		},
	);

	test('a single-plan run lists its id, status, plan and last update — no phase counter on a line that has no phases', async () => {
		const { context, logged, errors, exitCodes } = setupStatus({ manifests: [manifestOf()] });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-single  failed  plan: plans/demo.md  updated: 2026-01-01T00:00:03.000Z']);
		expect(errors).toStrictEqual([]);
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

		expect(logged.join('\n')).not.toMatch(/no live process/);
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
});
