import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveWatchTarget } from '#src/cli/common/utils/resolveWatchTarget.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';

const manifestOf = ({ runId, status, updatedAt }: { runId: string; status: RunStatus; updatedAt: string }): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt,
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/** A repo whose runs directory holds exactly the given manifests. */
const setupRuns = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-watch-target-'));

	mkdirSync(join(cwd, '.lightsout', 'runs'), { recursive: true });

	const plant = ({ runId, status, updatedAt }: { runId: string; status: RunStatus; updatedAt: string }) => {
		mkdirSync(join(cwd, '.lightsout', 'runs', runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', runId, 'manifest.json'), JSON.stringify(manifestOf({ runId, status, updatedAt })), 'utf8');
	};

	return { cwd, plant };
};

describe('resolveWatchTarget', () => {
	test('a run already going is answered at once, without spending any of the grace', async () => {
		const { cwd, plant } = setupRuns();

		plant({ runId: 'run-going', status: RunStatus.Running, updatedAt: '2026-01-01T00:00:01.000Z' });

		const started = Date.now();

		expect(await resolveWatchTarget({ cwd, graceMs: 5_000, pollMs: 50 })).toBe('run-going');
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	test('the most recently updated going run wins, so a watch follows the current work', async () => {
		const { cwd, plant } = setupRuns();

		plant({ runId: 'run-older', status: RunStatus.Running, updatedAt: '2026-01-01T00:00:01.000Z' });
		plant({ runId: 'run-newer', status: RunStatus.Pending, updatedAt: '2026-01-01T00:05:00.000Z' });

		expect(await resolveWatchTarget({ cwd, graceMs: 200, pollMs: 20 })).toBe('run-newer');
	});

	test('a repo whose runs have all finished answers undefined once the grace period passes', async () => {
		const { cwd, plant } = setupRuns();

		plant({ runId: 'run-done', status: RunStatus.Passed, updatedAt: '2026-01-01T00:05:00.000Z' });

		expect(await resolveWatchTarget({ cwd, graceMs: 150, pollMs: 20 })).toBeUndefined();
	});

	test('a repo with no runs at all answers undefined rather than throwing', async () => {
		const { cwd } = setupRuns();

		expect(await resolveWatchTarget({ cwd, graceMs: 150, pollMs: 20 })).toBeUndefined();
	});

	test('a run that appears mid-wait is picked up — the race the implement skill would otherwise lose', async () => {
		const { cwd, plant } = setupRuns();

		setTimeout(() => plant({ runId: 'run-late', status: RunStatus.Running, updatedAt: '2026-01-01T00:05:00.000Z' }), 60);

		expect(await resolveWatchTarget({ cwd, graceMs: 5_000, pollMs: 20 })).toBe('run-late');
	});
});
