import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, describe, test } from '@jest/globals';
import { RunStatus, type RunManifest } from '@/contracts';
import { parseFlags } from '@/cli/common/args/parseFlags';
import { resumeCommand } from '@/cli/resumeCommand';
import { captureCommandOutput } from '@tests/helpers/captureCommandOutput';
import { setupConsumerRepo } from '@tests/helpers/setupConsumerRepo';

/** The id every seeded run answers to, so the assertions can name it. */
const runId = 'run-resume-01';

/** A stopped implement run, unless the case overrides what it stopped as. */
const manifestOf = (overrides: Partial<RunManifest> = {}): RunManifest => ({
	runId,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:03.000Z',
	plan: 'ghost.md',
	harness: 'claude-code',
	status: RunStatus.Failed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	...overrides,
});

/**
 * A real consumer repo holding the run to resume. Every seeded manifest names a
 * plan file that does not exist, so whichever pipeline the command routes to
 * fails at the plan read — before any harness is spawned — and the routing plus
 * the render-and-exit path stay observable without an agent. `locked` plants a
 * live run lock, the other way a resumed run stops immediately.
 */
const setupResume = ({
	args = [],
	manifest,
	locked,
	config,
}: { args?: string[]; manifest?: RunManifest; locked?: boolean; config?: Record<string, unknown> } = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config });

	if (manifest) {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest));
	}

	if (locked) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

describe('resumeCommand', () => {
	test('without --run it prints the usage text on stderr and exits 1 before reading any run', async () => {
		const { context, logged, errors, exitCodes } = setupResume({ args: ['--skip-refactor'] });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors[0] ?? '').toMatch(/^lightsout — deterministic engine for coding agents/);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a --run naming no run on disk is the typed id being wrong, not a missing file', async () => {
		const { context, logged, errors, exitCodes } = setupResume({ args: ['--run', 'ghost'] });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([`no run matching 'ghost' — list the runs this repo has with: lightsout status`]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a refactor run is sent to its own resume door rather than continued here', async () => {
		const { context, errors, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: 'refactor' }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual([`run ${runId} belongs to the refactor pipeline — resume it with: lightsout refactor --run ${runId}`]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a run that already passed has nothing to resume', async () => {
		const { context, errors, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ status: RunStatus.Passed }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual([`run ${runId} already passed — nothing to resume`]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('an implement run is continued by the implement pipeline, its banner naming the state it stopped in', async () => {
		const { context, errors, logged, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: 'implement' }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe(`lightsout: resuming run ${runId} (was: failed, plan: ghost.md)`);
		// the single-plan pipeline ran: its own plan read is what stopped the run
		expect(errors.join('\n')).toMatch(/plan file not found: .*ghost\.md/);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a manifest written before runs recorded their pipeline still resumes as an implement run', async () => {
		const { context, errors, logged, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: undefined, status: RunStatus.PausedRateLimit }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe(`lightsout: resuming run ${runId} (was: paused-rate-limit, plan: ghost.md)`);
		expect(errors.join('\n')).toMatch(/plan file not found: .*ghost\.md/);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a phased run is continued by the coordinator, which stops on the phase that ends short', async () => {
		const { context, errors, exitCodes } = setupResume({
			args: ['--run', runId],
			manifest: manifestOf({
				pipeline: 'phases',
				plan: join('plans', 'demo', 'overview.md'),
				steps: [{ id: 'phase1.md', status: RunStatus.Pending, attempts: 0 }],
			}),
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the phase loop ran: only the coordinator reports a phase number and a resume id
		expect(errors.join('\n')).toMatch(/phase 1\/1 \(phase1\.md\) ended failed/);
		expect(errors.join('\n')).toContain(`resume with: lightsout resume --run ${runId}`);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a resumed phase colliding with a live run lock is reported in its own words, not as a crash', async () => {
		const { context, errors, exitCodes } = setupResume({
			args: ['--run', runId],
			locked: true,
			manifest: manifestOf({
				pipeline: 'phases',
				plan: join('plans', 'demo', 'overview.md'),
				steps: [{ id: 'phase1.md', status: RunStatus.Pending, attempts: 0 }],
			}),
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors.join('\n')).toContain('another lightsout run is active in this repo');
		expect(errors.join('\n')).not.toMatch(/ {4}at /);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('the harness the run started with wins over the config, and that config harness keeps its model to itself', async () => {
		const { context, logged } = setupResume({
			args: ['--run', runId],
			manifest: manifestOf({ harness: 'codex' }),
			config: { harness: 'claude-code', model: 'sonnet-x', effort: 'high' },
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the model names a model of the harness that is NOT resuming, so it is dropped; effort is harness-neutral and stays
		expect(logged.some((line) => line.startsWith('  harness: codex · model: harness default · effort: high'))).toBeTruthy();
	});

	test('a config model for the same harness the run recorded rides into the resumed run', async () => {
		const { context, logged } = setupResume({
			args: ['--run', runId],
			manifest: manifestOf({ harness: 'claude-code' }),
			config: { model: 'sonnet-x' },
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged.some((line) => line.startsWith('  harness: claude-code · model: sonnet-x'))).toBeTruthy();
	});
});
