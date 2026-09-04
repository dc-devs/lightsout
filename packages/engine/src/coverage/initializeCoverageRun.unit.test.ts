import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { readConfig } from '#src/common/config/readConfig.ts';
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { initializeCoverageRun } from '#src/coverage/initializeCoverageRun.ts';
import type { Driver } from '#src/drivers/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

const manifestWith = ({ pipeline, config }: { pipeline?: PipelineKind; config: LightsoutConfig }): RunManifest => ({
	runId: 'run-1',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: '.lightsout/runs/run-1/worklist.json',
	pipeline,
	harness: 'stub',
	config,
	status: RunStatus.PausedRateLimit,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	ledgerTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/** A measurable consumer repo: a coverage command that exits green and a summary already on disk. */
const setupMeasurable = ({ git = true }: { git?: boolean } = {}) => {
	const dir = setupConsumerRepo({ git: false, scripts: { 'test-coverage': 'true' } });

	mkdirSync(join(dir, 'coverage'), { recursive: true });
	writeFileSync(
		join(dir, 'coverage/coverage-summary.json'),
		JSON.stringify({ total: { statements: { pct: 61 } }, [join(dir, 'src/index.js')]: { statements: { pct: 12 } } }),
	);

	if (git) {
		execSync('git init -q && printf "coverage\\n" > .gitignore && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });
	}

	return dir;
};

/** A monorepo whose root coverage gate is off but whose packages each measure themselves. */
const setupScopedMeasurable = () => {
	const dir = setupConsumerRepo({
		git: false,
		config: { 'package-gates': { check: 'true {package}', test: 'true {package}', 'test-coverage': 'true {package}' } },
	});

	mkdirSync(join(dir, 'packages/api/coverage'), { recursive: true });
	writeFileSync(join(dir, 'packages/api/package.json'), JSON.stringify({ name: '@acme/api' }));
	writeFileSync(
		join(dir, 'packages/api/coverage/coverage-summary.json'),
		JSON.stringify({ total: { statements: { pct: 43 } }, [join(dir, 'packages/api/src/a.ts')]: { statements: { pct: 7 } } }),
	);

	execSync('git init -q && printf "coverage\\n" > .gitignore && git add -A && git -c user.name=t -c user.email=t@t commit -qm init', { cwd: dir });

	return dir;
};

describe('initializeCoverageRun', () => {
	test('a config that opted out of the coverage gate is refused before any run state exists', async () => {
		const cwd = setupConsumerRepo();

		const error = await getRejectionError({ promise: initializeCoverageRun({ cwd, runId: 'run-1', driver, config: await readConfig({ cwd }) }) });

		// the command has nothing to run, and silently skipping would look like success
		expect(error.message).toMatch(/opted out \("test-coverage": false\) — test-coverage-to-threshold has nothing to run/);
	});

	test('a per-package coverage gate keeps the run alive even with the root gate switched off', async () => {
		const cwd = setupScopedMeasurable();

		const { worklist } = await initializeCoverageRun({ cwd, runId: 'run-1', driver, config: await readConfig({ cwd }) });

		// a monorepo measures per package — the root gate being off is not an opt-out
		expect(worklist.totals).toStrictEqual([{ scope: 'api', statementsPct: 43, passed: true }]);
	});

	test('without git the run refuses to start, because its diff could never be attributed', async () => {
		const cwd = setupMeasurable({ git: false });

		const error = await getRejectionError({ promise: initializeCoverageRun({ cwd, runId: 'run-1', driver, config: await readConfig({ cwd }) }) });

		expect(error.message).toMatch(/requires a git worktree/);
	});

	test('a dirty tree is a hard error naming what is dirty', async () => {
		const cwd = setupMeasurable();

		writeFileSync(join(cwd, 'src/uncommitted.js'), 'export const later = 1;\n');

		const error = await getRejectionError({ promise: initializeCoverageRun({ cwd, runId: 'run-1', driver, config: await readConfig({ cwd }) }) });

		expect(error.message).toMatch(/requires a clean tree/);
		expect(error.message).toContain('src/uncommitted.js');
	});

	test('allowDirty records the standing dirt as baseline instead of refusing the run', async () => {
		const cwd = setupMeasurable();

		writeFileSync(join(cwd, 'src/uncommitted.js'), 'export const later = 1;\n');

		const { manifest } = await initializeCoverageRun({ cwd, runId: 'run-1', driver, config: await readConfig({ cwd }), allowDirty: true });

		// frozen into the manifest, so batch attribution can never claim it
		expect(manifest.baselineDirtyFiles).toStrictEqual(['src/uncommitted.js']);
	});

	test('a fresh run freezes the initial measurement and stamps the manifest as this pipeline', async () => {
		const cwd = setupMeasurable();

		const { manifest, worklist } = await initializeCoverageRun({ cwd, runId: 'run-1', driver, config: await readConfig({ cwd }) });

		expect(manifest.pipeline).toBe('coverage');
		expect(manifest.plan).toBe(join('.lightsout', 'runs', 'run-1', 'worklist.json'));
		expect(worklist.totals).toStrictEqual([{ scope: 'root', statementsPct: 61, passed: true }]);
		// the frozen file is the before side of the final report — resume re-reads it
		expect(JSON.parse(readFileSync(join(cwd, manifest.plan), 'utf8'))).toStrictEqual(worklist);
	});

	test('resume re-reads the frozen measurement rather than measuring again', async () => {
		const cwd = setupMeasurable();
		const config = await readConfig({ cwd });
		const fresh = await initializeCoverageRun({ cwd, runId: 'run-1', driver, config });

		const resumed = await initializeCoverageRun({ cwd, runId: 'run-1', driver, config, existing: { ...fresh.manifest, pipeline: 'coverage' } });

		expect(resumed.worklist).toStrictEqual(fresh.worklist);
	});

	test.each([
		{ pipeline: undefined, named: 'implement', command: 'resume' },
		{ pipeline: PipelineKind.Implement, named: 'implement', command: 'resume' },
		{ pipeline: PipelineKind.Refactor, named: 'refactor', command: 'refactor' },
	])('a $named run is sent back to its own resume door', async ({ pipeline, named, command }) => {
		const cwd = setupMeasurable();
		const config = await readConfig({ cwd });

		const error = await getRejectionError({
			promise: initializeCoverageRun({ cwd, runId: 'run-1', driver, config, existing: manifestWith({ pipeline, config }) }),
		});

		expect(error.message).toBe(`run run-1 belongs to the ${named} pipeline — resume it with: lightsout ${command} --run run-1`);
	});
});
