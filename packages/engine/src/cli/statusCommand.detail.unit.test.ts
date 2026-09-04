import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { statusCommand } from '#src/cli/statusCommand.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';

// Mocked Imports
// -------------------------
// The two helpers that own a clock: `resolveWatchTarget` waits a minute for a
// run to appear and `watchRunProgress` repaints every two minutes, and neither
// takes its timings from this command. Each has its own test that drives those
// clocks directly; what belongs here is which of them the command reaches for.
// Everything else — the manifests, the lock, the rendering — is real.
const mockResolveWatchTarget = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();
const mockWatchRunProgress = jest.fn<(params: { cwd: string; runId?: string }) => Promise<void>>();

jest.mock('#src/cli/common/utils/resolveWatchTarget.ts', () => ({
	resolveWatchTarget: (params: { cwd: string }) => mockResolveWatchTarget(params),
}));
jest.mock('#src/cli/common/utils/watchRunProgress.ts', () => ({
	watchRunProgress: (params: { cwd: string; runId?: string }) => mockWatchRunProgress(params),
}));
// -------------------------

const manifestOf = ({ runId, ...overrides }: { runId: string } & Partial<RunManifest>): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:10:00.000Z',
	plan: 'plans/demo/plan.md',
	harness: 'claude-code',
	status: RunStatus.Failed,
	currentStep: null,
	steps: [
		{
			id: 'implement',
			status: RunStatus.Failed,
			attempts: 1,
			durationMs: 160_000,
			verification: {
				failedFamilies: ['check', 'test'],
				repairAttempts: { check: 2, test: 1 },
				failures: [
					{ kind: 'check', group: 'root', command: 'pnpm check', exitCode: 1, outputTail: 'type error' },
					{ kind: 'test', group: 'api', command: 'pnpm test', exitCode: 1, outputTail: 'first line\nFINAL OUTPUT' },
				],
				needsFormatting: false,
				guidedRepairAttempted: true,
				supervisorDiagnosis: 'stale dependency graph',
			},
		},
	],
	stepOrder: ['implement', 'format'],
	changedFiles: ['src/a.ts'],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	ledgerTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
	...overrides,
});

/** A real repo holding the given manifests, and the flag map the dispatcher would hand the command. */
const setupDetail = ({ manifests = [], args = {} }: { manifests?: RunManifest[]; args?: Record<string, string | true> } = {}) => {
	const captured = captureCommandOutput();
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-status-detail-'));

	mkdirSync(join(cwd, '.lightsout', 'runs'), { recursive: true });
	mockResolveWatchTarget.mockResolvedValue(undefined);
	mockWatchRunProgress.mockResolvedValue(undefined);

	for (const manifest of manifests) {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest), 'utf8');
	}

	return { context: { flags: new Map<string, string | true>(Object.entries(args)), rest: [], cwd }, ...captured };
};

describe('statusCommand detail view', () => {
	test('bare status still prints the listing and nothing else — the view scripts read is untouched', async () => {
		const { context, logged, exitCodes } = setupDetail({ manifests: [manifestOf({ runId: 'run-alpha' })] });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['run-alpha  failed  plan: plans/demo/plan.md  updated: 2026-01-01T00:10:00.000Z']);
		expect(mockWatchRunProgress).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--run prints the block for that run and exits 0', async () => {
		const { context, logged, errors, exitCodes } = setupDetail({ manifests: [manifestOf({ runId: 'run-alpha' })], args: { run: 'run-alpha' } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe('');
		expect(logged.some((line) => line.startsWith(' ✗  implement'))).toBe(true);
		// the step the run never reached still gets a row, from the order it declared
		expect(logged.some((line) => line.startsWith(' ·  format'))).toBe(true);
		expect(logged).toContain(' verification  check, test · groups root, api · repairs check=2, test=1 · guided yes');
		expect(logged).toContain(' diagnosis     stale dependency graph');
		expect(logged).toContain(' last output   FINAL OUTPUT');
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('--run takes the shortened eight-character id a report printed', async () => {
		const { context, logged, exitCodes } = setupDetail({
			manifests: [manifestOf({ runId: 'e643832a-0000-4000-8000-000000000000' })],
			args: { run: 'e643832a' },
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[1]?.endsWith('e643832a')).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a --run matching nothing is the typed id being wrong, said once on stderr', async () => {
		const { context, logged, errors, exitCodes } = setupDetail({ manifests: [manifestOf({ runId: 'run-alpha' })], args: { run: 'ghost' } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([`no run matching 'ghost' — list the runs this repo has with: lightsout status`]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('--run with --watch follows exactly that run', async () => {
		const { context, exitCodes } = setupDetail({ manifests: [manifestOf({ runId: 'run-alpha' })], args: { run: 'run-alpha', watch: true } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockWatchRunProgress).toHaveBeenCalledWith({ cwd: context.cwd, runId: 'run-alpha' });
		expect(mockResolveWatchTarget).not.toHaveBeenCalled();
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a bare --watch waits for a run to be going, then follows whatever is going each frame', async () => {
		const { context, exitCodes } = setupDetail({ manifests: [manifestOf({ runId: 'run-alpha', status: RunStatus.Running })], args: { watch: true } });

		mockResolveWatchTarget.mockResolvedValue('run-alpha');

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		// no runId: follow mode re-resolves its own target, which is what makes a
		// phased plan watchable
		expect(mockWatchRunProgress).toHaveBeenCalledWith({ cwd: context.cwd });
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a bare --watch in a repo where nothing is going paints the newest run once instead of waiting in silence', async () => {
		const { context, logged, exitCodes } = setupDetail({
			manifests: [
				manifestOf({ runId: 'run-older', updatedAt: '2026-01-01T00:01:00.000Z' }),
				manifestOf({ runId: 'run-newer', updatedAt: '2026-01-01T00:09:00.000Z' }),
			],
			args: { watch: true },
		});

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(mockWatchRunProgress).not.toHaveBeenCalled();
		expect(logged[1]?.endsWith('run-newe')).toBe(true);
		expect(exitCodes).toStrictEqual([0]);
	});

	test('a bare --watch in a repo with no runs at all says so, the way the listing does', async () => {
		const { context, logged, exitCodes } = setupDetail({ args: { watch: true } });

		await expect(statusCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual(['no runs found']);
		expect(exitCodes).toStrictEqual([0]);
	});
});
