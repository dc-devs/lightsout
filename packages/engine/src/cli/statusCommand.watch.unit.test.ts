import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { type RunManifest, RunStatus, ShipStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

/**
 * The one branch of `--watch` a test can drive end to end without a clock: a run
 * that has already stopped. The repaint loop paints its frame, reads a terminal
 * status, and ends — so nothing here is stubbed, and the watch itself runs.
 *
 * The going-run cases belong to `watchRunProgress`'s own test, which drives the
 * two-minute cadence and the phase handoff directly; the sibling status tests
 * stub the watch for the same reason.
 */
const manifestOf = ({ runId, ...overrides }: { runId: string } & Partial<RunManifest>): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:01:00.000Z',
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status: RunStatus.Failed,
	currentStep: null,
	steps: [{ id: 'implement', status: RunStatus.Failed, attempts: 1, durationMs: 60_000 }],
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

/** A temp checkout holding one run, optionally with a ship result already filed for its branch. */
const setupWatch = ({ manifest, shipped = false }: { manifest: RunManifest; shipped?: boolean }) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-status-watch-'));

	mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
	writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest), 'utf8');

	if (shipped && manifest.branch !== undefined) {
		mkdirSync(join(cwd, '.lightsout', 'ship'), { recursive: true });
		writeFileSync(
			join(cwd, '.lightsout', 'ship', `${manifest.branch}.json`),
			JSON.stringify({ status: ShipStatus.Shipped, branch: manifest.branch, failingChecks: [] }),
			'utf8',
		);
	}

	return {
		context: {
			flags: new Map<string, string | true>([
				['run', manifest.runId],
				['watch', true],
			]),
			rest: [],
			cwd,
		},
		...captured,
	};
};

describe('statusCommand --run --watch', () => {
	test('a run that has already stopped is painted once and the watch ends there', async () => {
		const { context, logged, errors, exitCodes } = setupWatch({ manifest: manifestOf({ runId: 'run-over' }) });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		// one leading blank line means one frame: a repaint would append a second
		expect(logged.filter((line) => line === '')).toStrictEqual(['']);
		expect(logged.some((line) => /^ ✗ {2}implement +failed +1m 00s$/.test(line))).toBe(true);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a passed run whose ship result is already filed paints that outcome and does not wait for one', async () => {
		const { context, logged, exitCodes } = setupWatch({
			manifest: manifestOf({
				runId: 'run-shipped',
				status: RunStatus.Passed,
				willShip: true,
				branch: 'lo-9-demo',
				steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 1, durationMs: 60_000 }],
			}),
			shipped: true,
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.some((line) => /^ ✓ {2}ship +passed +—$/.test(line))).toBe(true);
		// the settle exists for a ship still in flight; a filed result skips it, so
		// there is no second frame
		expect(logged.filter((line) => line === '')).toStrictEqual(['']);
		expect(exitCodes).toStrictEqual([0]);
	});
});
