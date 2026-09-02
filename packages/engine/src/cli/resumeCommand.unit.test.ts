import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resumeCommand } from '#src/cli/resumeCommand.ts';
import { RunStatus } from '#src/contracts/index.ts';
import { manifestOf, runId, setupResume } from '#tests/helpers/setupResume.ts';

/** The seeded run's manifest as it stands on disk after the command ran. */
const readManifest = ({ cwd }: { cwd: string }): { willShip?: boolean } =>
	JSON.parse(readFileSync(join(cwd, '.lightsout', 'runs', runId, 'manifest.json'), 'utf8'));

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

	test('a queue run is sent back to `lightsout queue` itself, with no --run flag the command does not take', async () => {
		const { context, errors, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: 'queue' }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// re-running the queue IS its resume path, so a `--run <id>` here would be a flag the reader could not type
		expect(errors).toStrictEqual([`run ${runId} belongs to the queue pipeline — resume it with: lightsout queue (a restart resumes parked tickets first)`]);
		expect(exitCodes).toStrictEqual([1]);
	});

	test('a direct run is sent back to its ticket flag, the placeholder left for the reader to fill in', async () => {
		const { context, errors, exitCodes } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: 'direct' }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// only `<id>` has a manifest source — `<path>` has none and prints as written
		expect(errors).toStrictEqual([
			`run ${runId} belongs to the direct pipeline — resume it with: lightsout implement-direct --ticket <path> (re-run with the same ticket)`,
		]);
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

	test.each([
		{ label: 'a run stamped to ship', willShip: true },
		{ label: 'a run that was never going to', willShip: undefined },
	])('resume clears the ship stamp on $label — this command is not a shipping path', async ({ willShip }) => {
		const { context, cwd } = setupResume({ args: ['--run', runId], manifest: manifestOf({ pipeline: 'implement', willShip }) });

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// resume ends at exitForRunResult and never chains into ship, so a stamp
		// left standing would draw a ship row nothing will ever fill
		expect(readManifest({ cwd }).willShip).toBe(willShip === true ? false : undefined);
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
		// --skip-refactor drops the refactor trio, leaving exactly these seven steps;
		// each already recorded passed, so the run re-enters, spawns no harness, and
		// reaches the end — the only way the success exit code is observable here.
		const { context, logged, exitCodes } = setupResume({
			args: ['--run', runId, '--skip-refactor'],
			manifest: manifestOf({
				pipeline: 'implement',
				plan: 'plan.md',
				steps: ['clean-slate', 'implement', 'format-implement', 'verify-implement', 'write-tests', 'format-tests', 'verify-tests'].map((id) => ({
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

	test('the resumed run’s banner names the pack roots the config declares, in config order', async () => {
		const { context, logged } = setupResume({
			args: ['--run', runId],
			manifest: manifestOf({ pipeline: 'implement' }),
			config: { 'standards-packs': ['standards/house', '/opt/acme-standards'] },
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		// a resumed run reads its standards from the config as it stands now, so
		// the banner has to say which packs the continuation will work against
		expect(logged).toContain('  standards packs: standards/house, /opt/acme-standards');
	});

	test('standards turned off explicitly are announced as such on the resume banner', async () => {
		const { context, logged } = setupResume({
			args: ['--run', runId],
			manifest: manifestOf({ pipeline: 'implement' }),
			config: { 'standards-packs': false },
		});

		await expect(resumeCommand(context)).rejects.toThrow(/process\.exit/);

		expect(logged).toContain('  standards packs: none (explicit)');
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
