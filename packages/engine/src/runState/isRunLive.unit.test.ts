import { expect, test } from '@jest/globals';
import { type RunLock, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { isRunLive } from '#src/runState/index.ts';

const manifest = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId: 'run-parent',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:01:00.000Z',
	plan: 'plans/demo/overview.md',
	harness: 'claude-code',
	status: RunStatus.Running,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
	...overrides,
});

const lock = (overrides: Partial<RunLock> = {}): RunLock => ({
	pid: process.pid,
	runId: 'run-parent',
	startedAt: '2026-01-01T00:00:00.000Z',
	...overrides,
});

test('nothing holds the lock, so no process stands behind the run', () => {
	expect(isRunLive({ manifest: manifest(), lock: undefined })).toBe(false);
});

test('a lock whose process is gone is a crash leftover, not a live run', () => {
	// pid 1 exists; a pid this far out of range does not, which is what makes a
	// stale lock detectable rather than indistinguishable from a healthy one
	expect(isRunLive({ manifest: manifest(), lock: lock({ pid: 2 ** 30 }) })).toBe(false);
});

test('a live lock naming this run is the simple case', () => {
	expect(isRunLive({ manifest: manifest(), lock: lock() })).toBe(true);
});

test('a phased run is live while the lock is held under the child run its running step names', () => {
	const phased = manifest({
		pipeline: 'phases',
		steps: [{ id: 'phase1', status: RunStatus.Running, attempts: 1, report: { runId: 'run-child' } }],
	});

	// the coordinator holds no lock of its own — accepting the child's id is what
	// keeps a healthy sequence from being branded a crash
	expect(isRunLive({ manifest: phased, lock: lock({ runId: 'run-child' }) })).toBe(true);
	// a lock held under some other run says nothing about this one
	expect(isRunLive({ manifest: phased, lock: lock({ runId: 'run-stranger' }) })).toBe(false);
});

test('a phased run between phases has no running step to vouch for the lock holder', () => {
	const between = manifest({ pipeline: 'phases', steps: [{ id: 'phase1', status: RunStatus.Passed, attempts: 1 }] });

	expect(isRunLive({ manifest: between, lock: lock({ runId: 'run-child' }) })).toBe(false);
});

test('a phased run whose running step reports no child run id cannot vouch for the lock holder', () => {
	// a step that has started but not yet recorded its PhaseReport, and a step whose
	// report is present but not a phase report at all — neither names a child run,
	// so neither can claim the lock held under some other id
	const unreported = manifest({
		pipeline: 'phases',
		steps: [{ id: 'phase1', status: RunStatus.Running, attempts: 1 }],
	});
	const malformed = manifest({
		pipeline: 'phases',
		steps: [{ id: 'phase1', status: RunStatus.Running, attempts: 1, report: { summary: 'no run id here' } }],
	});

	expect(isRunLive({ manifest: unreported, lock: lock({ runId: 'run-child' }) })).toBe(false);
	expect(isRunLive({ manifest: malformed, lock: lock({ runId: 'run-child' }) })).toBe(false);
});

test('a non-phased run never borrows another run id, however its steps are reported', () => {
	const implement = manifest({ steps: [{ id: 'implement', status: RunStatus.Running, attempts: 1, report: { runId: 'run-child' } }] });

	expect(isRunLive({ manifest: implement, lock: lock({ runId: 'run-child' }) })).toBe(false);
});
