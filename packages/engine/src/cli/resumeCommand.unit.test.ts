import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { parseFlags } from '#src/cli/common/args/parseFlags.ts';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import { type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { captureCommandOutput } from '#tests/helpers/captureCommandOutput.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

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
	testSubjects: [],
	unreachableChangedFiles: [],
	...overrides,
});

/**
 * A real consumer repo holding the run to resume. Every seeded manifest names a
 * plan file that does not exist, so whichever pipeline the command routes to
 * fails at the plan read — before any harness is spawned — and the routing plus
 * the render-and-exit path stay observable without an agent. `locked` plants a
 * live run lock, the other way a resumed run stops immediately; `ledger` plants
 * the per-invocation agent spend the end-of-run summary tallies.
 */
const setupResume = ({
	args = [],
	manifest,
	ledger,
	friction,
	rejectedReports,
	locked,
	config,
	rawManifest,
}: {
	args?: string[];
	manifest?: RunManifest;
	/** Per-invocation agent spend for the seeded run, written as its agents.jsonl. */
	ledger?: { step: string; outputTokens: number; costUsd: number }[];
	/** Friction the run's agents reported, written as the repo's friction.jsonl. */
	friction?: { at: string; runId: string; step: string; area: string; detail: string }[];
	/** File names under the run's agents/ folder — a `rejected-` prefix is a report that failed its contract. */
	rejectedReports?: string[];
	locked?: boolean;
	config?: Record<string, unknown>;
	/** Manifest text written verbatim under the seeded run id — the way a manifest that does not parse gets onto disk. */
	rawManifest?: string;
} = {}) => {
	const captured = captureCommandOutput();
	const cwd = setupConsumerRepo({ config });

	if (rawManifest !== undefined) {
		mkdirSync(join(cwd, '.lightsout', 'runs', runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', runId, 'manifest.json'), rawManifest);
	}

	if (manifest) {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'manifest.json'), JSON.stringify(manifest));
	}

	if (manifest && ledger) {
		writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'agents.jsonl'), ledger.map((record) => `${JSON.stringify(record)}\n`).join(''));
	}

	if (friction) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'friction.jsonl'), friction.map((record) => `${JSON.stringify(record)}\n`).join(''));
	}

	if (manifest && rejectedReports) {
		mkdirSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'agents'), { recursive: true });

		for (const name of rejectedReports) {
			writeFileSync(join(cwd, '.lightsout', 'runs', manifest.runId, 'agents', name), '{}\n');
		}
	}

	if (locked) {
		mkdirSync(join(cwd, '.lightsout'), { recursive: true });
		writeFileSync(join(cwd, '.lightsout', 'lock.json'), JSON.stringify({ pid: process.pid, runId: 'already-running', startedAt: '2026-01-01T00:00:00.000Z' }));
	}

	return { context: { flags: parseFlags({ args }), rest: [], cwd }, cwd, ...captured };
};

/**
 * A resumed run whose seeded evidence makes the end-of-run summary worth
 * reading: one finished step carrying a duration, a file list and recorded
 * agent spend, plus the run-wide usage totals. The resumed pipeline still stops
 * at its own plan read, so the summary renders over exactly this state.
 */
const setupResumeSummary = () =>
	setupResume({
		args: ['--run', runId],
		manifest: manifestOf({
			pipeline: 'implement',
			steps: [{ id: 'implement', status: RunStatus.Passed, attempts: 2, durationMs: 65_000, changedFiles: ['src/a.ts', 'src/b.ts'] }],
			usage: { invocations: 3, inputTokens: 1_000_000, outputTokens: 3_400, cacheReadTokens: 600_000, cacheCreationTokens: 400_000, costUsd: 1.5 },
		}),
		ledger: [{ step: 'implement', outputTokens: 3_400, costUsd: 1.5 }],
	});

/**
 * A resumed run carrying the evidence the report card's conditional lines read:
 * a recorded package scope and where it came from, changed files no public
 * surface reaches, the friction its agents reported, and a report that failed
 * its contract and cost a re-emit. The resumed pipeline stops at its own plan
 * read, so none of it is overwritten before the summary renders.
 */
const setupResumeEvidence = () =>
	setupResume({
		args: ['--run', runId],
		manifest: manifestOf({
			pipeline: 'implement',
			packages: ['api', 'web'],
			packagesSource: 'flag',
			unreachableChangedFiles: ['src/orphan.ts', 'src/stray.ts'],
		}),
		friction: [
			{ at: '2026-01-01T00:00:01.000Z', runId, step: 'implement', area: 'plan', detail: 'the plan named no owner' },
			{ at: '2026-01-01T00:00:02.000Z', runId, step: 'write-tests', area: 'plan', detail: 'the mirror file used the older style' },
			{ at: '2026-01-01T00:00:03.000Z', runId, step: 'implement', area: 'environment', detail: 'the jest config lacked clearMocks' },
			// another run's friction shares the log, and must not be counted against this one
			{ at: '2026-01-01T00:00:04.000Z', runId: 'run-elsewhere', step: 'implement', area: 'prompt', detail: 'not this run' },
		],
		rejectedReports: ['rejected-implement-1.json', 'implement-1.json'],
	});

/** The step-table rows the summary printed, each split back into its trimmed cell values. */
const tableRows = ({ logged }: { logged: string[] }) =>
	logged
		.filter((line) => line.startsWith('│'))
		.map((row) =>
			row
				.split('│')
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);

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

	test('a manifest on disk that does not parse is a hard error, never softened into the message a mistyped id gets', async () => {
		const { context, logged, errors, exitCodes } = setupResume({ args: ['--run', runId], rawManifest: '{ "runId": ' });

		await expect(resumeCommand(context)).rejects.toThrow(SyntaxError);

		// the run exists — the file behind it is broken, which is a different
		// problem, so nothing claims the id was wrong and nothing exits as handled
		expect(logged).toStrictEqual([]);
		expect(errors).toStrictEqual([]);
		expect(exitCodes).toStrictEqual([]);
	});

	test('a refactor run is sent to its own resume door rather than continued here', async () => {
		const { context, errors, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: 'refactor' }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(errors).toStrictEqual([`run ${runId} belongs to the refactor pipeline — resume it with: lightsout refactor --run ${runId}`]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a coverage run is sent to its own resume door too, named exactly as it is typed', async () => {
		const { context, errors, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: 'coverage' }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// a hint a reader retypes is a contract: the wrong command word sends them nowhere
		expect(errors).toStrictEqual([`run ${runId} belongs to the coverage pipeline — resume it with: lightsout test-coverage-to-threshold --run ${runId}`]);
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
		const { context, errors, logged, exitCodes } = setupResume({
			args: ['--run', runId],
			manifest: manifestOf({ pipeline: undefined, status: RunStatus.PausedRateLimit }),
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged[0]).toBe(`lightsout: resuming run ${runId} (was: paused-rate-limit, plan: ghost.md)`);
		expect(errors.join('\n')).toMatch(/plan file not found: .*ghost\.md/);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a resumed run that walks past every remaining step finishes it and exits 0', async () => {
		// --skip-refactor drops the refactor pair, leaving exactly these six steps;
		// each already recorded passed, so the run re-enters, spawns no harness, and
		// reaches the end — the only way the success exit code is observable here.
		const { context, logged, exitCodes } = setupResume({
			args: ['--run', runId, '--skip-refactor'],
			manifest: manifestOf({
				pipeline: 'implement',
				plan: 'plan.md',
				steps: ['clean-slate', 'implement', 'verify-implement', 'write-tests', 'verify-tests', 'format'].map((id) => ({
					id,
					status: RunStatus.Passed,
					attempts: 1,
				})),
			}),
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the manifest is left saying the run passed, and the report says so too —
		// under the shortened id a reader retypes into the next command
		expect(logged).toContain('run       run-resu · PASSED');
		expect(logged).toContain('plan      plan.md');
		expect(exitCodes).toStrictEqual([0]);
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

	test('the run summary tables each finished step — its outcome icon, tries, active time, agent spend and the files it touched', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// 65s crosses the minute mark, so the time reads as minutes and zero-padded seconds
		expect(tableRows({ logged })).toContainEqual(['✓ implement', '2', '1m 05s', '1', '3.4k', '$1.50', '2']);
	});

	test('a step the run never got to renders every unknown column as an em dash rather than a zero', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the plan read stops the run at clean-slate: no duration, no invocation, no files
		expect(tableRows({ logged })).toContainEqual(['✗ clean-slate', '0', '—', '—', '—', '—', '—']);
	});

	test('the totals line sums the run — active time, invocations, output tokens, cost and files — and never a try count', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(tableRows({ logged })).toContainEqual(['total', '—', '1m 05s', '1', '3.4k', '$1.50', '2']);
	});

	test('the run-wide spend is reported in scaled token counts, with the share the model read from cache', async () => {
		const { context, logged } = setupResumeSummary();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// 600k of the 2M readable input came from cache
		expect(logged).toContain('tokens    in 1.0M · out 3.4k · cache-read 600.0k (30%)');
		expect(logged).toContain('cost      $1.50 API-equivalent · 3 invocations');
	});

	test('the report card names the package scope the run worked in, and where that scope came from', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// a scope a reader cannot trace back to a flag, front matter or the plan paths is a scope they cannot argue with
		expect(logged).toContain('scope     api · web (flag)');
	});

	test('changed files no public surface reaches are reported as a warning, never left silent', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain(
			'warning   unreachable-changed-files: src/orphan.ts, src/stray.ts — changed, but no public surface reaches them; no tests cover them',
		);
	});

	test('friction is totalled and broken down by area, counting only what this run reported', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// the fourth log entry belongs to another run, so the total is 3 rather than 4
		expect(logged).toContain('friction  3 · plan 2 · environment 1');
	});

	test('a report that failed its contract is counted as a retry, so a re-emit never passes unnoticed', async () => {
		const { context, logged } = setupResumeEvidence();

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// only the rejected- prefixed file counts; the accepted report beside it does not
		expect(logged).toContain('retries   1 rejected report re-emitted');
	});
});
