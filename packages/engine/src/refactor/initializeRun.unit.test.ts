import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { type LightsoutConfig, type PipelineKind, RefactorWorklist, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { initializeRun } from '#src/refactor/index.ts';
import { getRejectionError } from '#tests/helpers/getRejectionError.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'stub', invoke: async () => ({ text: '', exitCode: 0 }) };

const manifestWith = ({ pipeline }: { pipeline?: PipelineKind }): RunManifest => ({
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
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/**
 * A committed repo whose one planted defect — a second export in a file — sits
 * inside a package under `packages/`, so what the run batches it under is
 * decided by the packages folder rather than by the top path segment.
 */
const setupPackageRepo = () =>
	setupConsumerRepo({ sources: { 'packages/web/src/config.js': 'export const readConfig = () => 1;\nexport const saveConfig = () => 2;\n' } });

/** The work-list the run froze into its run dir, read back through its contract. */
const readFrozenWorklist = ({ cwd, manifest }: { cwd: string; manifest: RunManifest }) =>
	RefactorWorklist.parse(JSON.parse(readFileSync(join(cwd, manifest.plan), 'utf8')));

describe('initializeRun', () => {
	test('refuses to resume a manifest the implement pipeline owns, naming the command that would', async () => {
		const cwd = setupConsumerRepo();

		const error = await getRejectionError({
			promise: initializeRun({ cwd, runId: 'run-1', driver, config, existing: manifestWith({ pipeline: 'implement' }) }),
		});

		expect(error.message).toMatch(/belongs to the implement pipeline — resume it with: lightsout resume --run run-1/);
	});

	test('a manifest written before the pipeline field existed is treated as an implement run', async () => {
		const cwd = setupConsumerRepo();

		// pre-discriminator manifests carry no pipeline; assuming refactor would
		// let `lightsout refactor --run` hijack somebody's implement run
		const error = await getRejectionError({ promise: initializeRun({ cwd, runId: 'run-1', driver, config, existing: manifestWith({}) }) });

		expect(error.message).toMatch(/belongs to the implement pipeline/);
	});

	test('a fresh run computes the work-list from the tree and freezes the very list it returns', async () => {
		const cwd = setupPackageRepo();

		const { manifest, worklist } = await initializeRun({ cwd, runId: 'run-1', driver, config });

		// the manifest points at the frozen file, and the frozen file is what the
		// caller got — resume re-reads this rather than checking the tree again
		expect(manifest.plan).toBe('.lightsout/runs/run-1/worklist.json');
		expect(readFrozenWorklist({ cwd, manifest })).toEqual(worklist);
		// a run given no scope and no burn-down mode records both
		expect(worklist).toEqual(expect.objectContaining({ path: '.', all: false }));
	});

	test("batches a package's finding under the packages folder lightsout supplies when the config names none", async () => {
		const cwd = setupPackageRepo();

		const { worklist } = await initializeRun({ cwd, runId: 'run-1', driver, config });

		const batch = worklist.batches.find((entry) => entry.rule === 'multi-export');

		// 'packages/web' rather than 'packages': the area is the package, which it
		// can only be if the default packages folder is the one the engine's own
		// readers use — a second copy of the word here could disagree with them
		expect(batch?.folder).toBe('packages/web');
		expect(batch?.blocking.map((finding) => finding.siteKey)).toStrictEqual(['multi-export:packages/web/src/config.js']);
	});

	test('reads the packages folder the config names, so a repo whose packages live elsewhere is batched by it', async () => {
		const cwd = setupPackageRepo();

		const { worklist } = await initializeRun({ cwd, runId: 'run-1', driver, config: { ...config, 'packages-dir': 'modules' } });

		const batch = worklist.batches.find((entry) => entry.rule === 'multi-export');

		// nothing sits under 'modules', so the planted file falls back to its top
		// segment — the configured folder is what decides, never the default
		expect(batch?.folder).toBe('packages');
	});
});
