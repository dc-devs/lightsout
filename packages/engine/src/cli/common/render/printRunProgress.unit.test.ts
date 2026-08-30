import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { printRunProgress } from '#src/cli/common/render/printRunProgress.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { RunNotFoundError } from '#src/runState/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

const runId = 'run-printed-01';

const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:10:00.000Z',
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status: RunStatus.Failed,
	currentStep: null,
	steps: [{ id: 'implement', status: RunStatus.Failed, attempts: 2, durationMs: 160_000 }],
	stepOrder: ['implement', 'format'],
	changedFiles: ['src/a.ts'],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
	...overrides,
});

/** A real repo holding one run's manifest and its narration — the same files the CLI reads. */
const setupPrint = ({ manifest = manifestOf() }: { manifest?: RunManifest } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-print-progress-'));

	mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
	writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest), 'utf8');
	writeFileSync(
		join(cwd, '.lightsout', 'runs', manifest.runId, 'progress.jsonl'),
		`${JSON.stringify({ at: '2026-01-01T00:09:00.000Z', message: 'step implement' })}\n`,
		'utf8',
	);

	return { cwd, ...captured };
};

describe('printRunProgress', () => {
	test('appends one frame: a blank line, then the block', async () => {
		const { cwd, logged } = setupPrint();

		await printRunProgress({ cwd, runId });

		expect(logged[0]).toBe('');
		expect(logged[1]?.endsWith('run-prin')).toBe(true);
		expect(logged.some((line) => line.includes('implement') && line.includes('failed (x2)'))).toBe(true);
		expect(logged.at(-1)).toBe(' now  step implement');
	});

	test('clears nothing — a frame relayed into a chat transcript must leave the frames before it readable', async () => {
		const { cwd, logged } = setupPrint();

		await printRunProgress({ cwd, runId });

		// no cursor-control sequence of any kind: every frame is appended
		expect(logged.some((line) => line.includes(String.fromCharCode(27)))).toBe(false);
	});

	test('answers with the view behind the frame, so a watch decides from the same read', async () => {
		const { cwd } = setupPrint();

		const progress = await printRunProgress({ cwd, runId });

		expect(progress).toEqual(expect.objectContaining({ runId, status: RunStatus.Failed, live: false, awaitingShip: false }));
	});

	test('a run id nothing answers to is the reader’s mistake, reported as one', async () => {
		const { cwd } = setupPrint();

		await expect(printRunProgress({ cwd, runId: 'ghost' })).rejects.toThrow(RunNotFoundError);
	});
});
