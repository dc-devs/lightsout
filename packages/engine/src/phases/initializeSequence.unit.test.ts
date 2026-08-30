import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { initializeSequence } from '#src/phases/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { plantSequence } from '#tests/helpers/plantSequence.ts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

/** A plan folder holding an overview whose Phases table names one file per phase, plus the files themselves. */
const setupPlanFolder = ({ phases, duplicate = false }: { phases: number; duplicate?: boolean }) => {
	const dir = mkdtempSync(join(tmpdir(), 'lightsout-sequence-'));
	const folder = join(dir, 'plans', 'demo');
	const rows = Array.from({ length: phases }, (_, index) => `| ${index + 1} | \`phase${duplicate ? 1 : index + 1}.md\` | scope |`);

	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'overview.md'), `# Feature — Overview\n\n## Phases\n\n| # | File | Scope |\n|---|------|-------|\n${rows.join('\n')}\n`);

	for (let phase = 1; phase <= phases; phase += 1) {
		writeFileSync(join(folder, `phase${phase}.md`), `# Feature — Phase ${phase}\n`);
	}

	return { dir, overviewPath: join('plans', 'demo', 'overview.md') };
};

/** A manifest from one of the other pipelines, as `resume` would hand it in. */
const foreignManifest = ({ pipeline }: { pipeline?: PipelineKind }): RunManifest => ({
	runId: 'not-a-sequence',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	plan: join('plans', 'demo', 'phase1.md'),
	pipeline,
	harness: 'stub',
	status: RunStatus.Failed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	unreachableChangedFiles: [],
});

describe('initializeSequence', () => {
	test('a fresh sequence gets one pending step per phase, in the overview’s written order', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 2 });

		const { manifest } = await initializeSequence({ cwd: dir, driver, config, overviewPath });

		expect(manifest.pipeline).toBe('phases');
		expect(manifest.plan).toBe(overviewPath);
		expect(manifest.steps).toStrictEqual([
			{ id: 'phase1.md', status: 'pending', attempts: 0 },
			{ id: 'phase2.md', status: 'pending', attempts: 0 },
		]);
	});

	test('--start-phase records the earlier phases as done outside the sequence', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 2 });

		const { manifest } = await initializeSequence({ cwd: dir, driver, config, overviewPath, startPhase: 2 });

		// adopted, not implemented: passed with nothing spent on it
		expect(manifest.steps).toStrictEqual([
			{ id: 'phase1.md', status: 'passed', attempts: 0 },
			{ id: 'phase2.md', status: 'pending', attempts: 0 },
		]);
	});

	test('a fresh sequence records the ship intent it was started with', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 1 });

		const { manifest } = await initializeSequence({ cwd: dir, driver, config, overviewPath, willShip: true });

		// a phased run ships exactly as a single-plan run does, so its coordinator
		// carries the stamp the progress view draws the ship row from
		expect(manifest.willShip).toBe(true);
	});

	test('a fresh sequence records no ship intent when there was none', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 1 });

		const { manifest } = await initializeSequence({ cwd: dir, driver, config, overviewPath });

		expect(manifest.willShip).toBeUndefined();
	});

	test('an absolute overview path is recorded the way this repo stores plan paths', async () => {
		const { dir } = setupPlanFolder({ phases: 1 });

		const { manifest } = await initializeSequence({ cwd: dir, driver, config, overviewPath: join(dir, 'plans', 'demo', 'overview.md') });

		// stored cwd-relative, so the guard recognises the same overview named either way
		expect(manifest.plan).toBe(join('plans', 'demo', 'overview.md'));
	});

	test('a resume hands back the manifest it was given, untouched', async () => {
		const { dir } = setupPlanFolder({ phases: 1 });
		const existing = { ...foreignManifest({ pipeline: 'phases' }), plan: join('plans', 'demo', 'overview.md') };

		await expect(initializeSequence({ cwd: dir, driver, config, existing })).resolves.toStrictEqual({ manifest: existing });
	});

	test.each([
		{ label: 'a manifest written before the pipeline field existed', pipeline: undefined, named: 'implement', door: 'lightsout resume --run not-a-sequence' },
		{ label: 'a single-plan run', pipeline: PipelineKind.Implement, named: 'implement', door: 'lightsout resume --run not-a-sequence' },
		{ label: 'a refactor run', pipeline: PipelineKind.Refactor, named: 'refactor', door: 'lightsout refactor --run not-a-sequence' },
	])('resuming $label here is refused and names the door for the $named pipeline', async ({ pipeline, named, door }) => {
		const { dir } = setupPlanFolder({ phases: 1 });

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config, existing: foreignManifest({ pipeline }) }) });

		expect(error.message).toContain(`belongs to the ${named} pipeline`);
		expect(error.message).toContain(door);
	});

	test('a fresh sequence with no overview path is refused, and no state is written', async () => {
		const { dir } = setupPlanFolder({ phases: 1 });

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config }) });

		expect(error.message).toMatch(/needs an overview path/);
		expect(existsSync(join(dir, '.lightsout', 'runs'))).toBe(false);
	});

	test('an overview that is not on disk is refused, naming the path it looked for', async () => {
		const { dir } = setupPlanFolder({ phases: 1 });

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config, overviewPath: join('plans', 'demo', 'missing.md') }) });

		expect(error.message).toMatch(/overview file not found/);
		expect(error.message).toContain(join(dir, 'plans', 'demo', 'missing.md'));
		expect(existsSync(join(dir, '.lightsout', 'runs'))).toBe(false);
	});

	test('an overview with no Phases table rows is refused rather than run as an empty sequence', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 1 });

		writeFileSync(join(dir, 'plans', 'demo', 'overview.md'), '# Feature — Overview\n\n## Summary\n\nNo table here.\n');

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config, overviewPath }) });

		expect(error.message).toMatch(/no Phases table rows/);
		expect(existsSync(join(dir, '.lightsout', 'runs'))).toBe(false);
	});

	test('an overview listing the same phase file twice is refused before any state is written', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 2, duplicate: true });

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config, overviewPath }) });

		expect(error.message).toMatch(/overview lists phase1\.md twice/);
		// nothing was created — a malformed table fails before the run exists
		expect(existsSync(join(dir, '.lightsout', 'runs'))).toBe(false);
	});

	test.each([
		{ label: 'below the first phase', startPhase: 0 },
		{ label: 'past the last phase', startPhase: 3 },
		{ label: 'not a whole number', startPhase: 1.5 },
	])('--start-phase $startPhase ($label) is refused before any state is written', async ({ startPhase }) => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 2 });

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config, overviewPath, startPhase }) });

		expect(error.message).toContain('--start-phase must be between 1 and 2');
		expect(existsSync(join(dir, '.lightsout', 'runs'))).toBe(false);
	});

	test('a phase file the table names but disk lacks is refused upfront, not at that phase', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 2 });

		rmSync(join(dir, 'plans', 'demo', 'phase2.md'));

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config, overviewPath }) });

		expect(error.message).toMatch(/names files that do not exist/);
		expect(error.message).toContain(join('plans', 'demo', 'phase2.md'));
		// an unattended run learns about the typo before it spends anything on phase 1
		expect(existsSync(join(dir, '.lightsout', 'runs'))).toBe(false);
	});

	test('an unfinished sequence for this overview refuses a fresh start, naming the resume door', async () => {
		const { dir, overviewPath } = setupPlanFolder({ phases: 1 });

		plantSequence({ dir, runId: 'mid-flight-sequence', plan: overviewPath });

		const error = await getRejectionError({ promise: initializeSequence({ cwd: dir, driver, config, overviewPath }) });

		expect(error.message).toMatch(/an unfinished run for this plan already exists/);
		expect(error.message).toContain('lightsout resume --run mid-flight-sequence');
	});
});
