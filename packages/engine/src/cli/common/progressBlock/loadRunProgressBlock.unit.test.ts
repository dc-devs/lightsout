import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { loadRunProgressBlock } from '#src/cli/common/progressBlock/loadRunProgressBlock.ts';
import { renderRunProgress } from '#src/cli/common/render/renderRunProgress.ts';
import { type RunLock, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { RunNotFoundError } from '#src/runState/index.ts';
import { getRunProgress } from '#src/views/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

const runId = 'run-loaded-01';

/** The one clock both the loader and the expected view read — a live running row ticks from it. */
const pinnedNow = Date.parse('2026-01-01T00:12:00.000Z');

const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:10:00.000Z',
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status: RunStatus.Running,
	currentStep: 'test',
	steps: [
		{ id: 'implement', status: RunStatus.Passed, attempts: 2, durationMs: 160_000 },
		{ id: 'test', status: RunStatus.Running, attempts: 1, durationMs: 30_000 },
	],
	stepOrder: ['implement', 'test', 'format'],
	changedFiles: ['src/a.ts', 'src/b.ts'],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
	...overrides,
});

/**
 * A real repo holding one running run's manifest, its narration and the lock
 * this test process holds for it — the same files the status command reads —
 * plus the view and lines the loader must answer, built from those files.
 */
const setupLoad = async () => {
	const manifest = manifestOf();
	const lock: RunLock = { pid: process.pid, runId, startedAt: '2026-01-01T00:00:00.000Z' };
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-load-run-block-'));
	const runDir = join(cwd, '.lightsout', 'runs', runId);

	mkdirSync(runDir, { recursive: true });
	writeFileSync(join(runDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
	writeFileSync(join(runDir, 'progress.jsonl'), `${JSON.stringify({ at: '2026-01-01T00:09:00.000Z', message: 'step test' })}\n`, 'utf8');
	writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify(lock), 'utf8');
	jest.spyOn(Date, 'now').mockReturnValue(pinnedNow);

	const expectedProgress = await getRunProgress({ cwd, manifest, lock });
	const expectedLines = renderRunProgress({ progress: expectedProgress });
	const captured = captureCommandOutput();

	return { cwd, expectedProgress, expectedLines, ...captured };
};

describe('loadRunProgressBlock', () => {
	test("answers the run's progress view and the lines renderRunProgress draws for it, printing nothing", async () => {
		const { cwd, expectedProgress, expectedLines, logged } = await setupLoad();

		const block = await loadRunProgressBlock({ cwd, runId });

		expect({ block, logged }).toStrictEqual({ block: { progress: expectedProgress, lines: expectedLines }, logged: [] });
	});

	test('rejects with RunNotFoundError when no run answers to the id', async () => {
		const { cwd } = await setupLoad();

		await expect(loadRunProgressBlock({ cwd, runId: 'ghost' })).rejects.toThrow(RunNotFoundError);
	});
});
