import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { buildActivityTree } from '#src/activity/buildActivityTree.ts';
import type { ActivityLevel } from '#src/activity/common/types/ActivityLevel.ts';
import { readActivityMarks } from '#src/activity/readActivityMarks.ts';
import { ActivityLevelKind } from '#src/contracts/activity/ActivityLevelKind.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { RunManifest } from '#src/contracts/run/RunManifest.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';
import type { PipelineResult } from '#src/pipeline/PipelineResult.ts';
import { runPlanFolderPipeline } from '#src/queue/workers/internal/runPlanFolderPipeline.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

// What the queue's own in-process build leaves in the plan folder's activity
// record. The two pipelines it chooses between are stubbed, because what this
// file owns is the command run written around whichever one runs — and the
// level that build is handed to hang its own work from. Everything else is a
// real folder in a temporary checkout, read back off disk the way the report
// reads it.

/** What either pipeline is handed: the level is the new field, and the paths are what the folder's shape chooses between. */
interface PipelineCall {
	cwd: string;
	config: LightsoutConfig;
	driver: Driver;
	planPath?: string;
	overviewPath?: string;
	level?: ActivityLevel;
	onProgress?: (message: string) => void;
}

// Mocked Imports
// -------------------------
const mockRunPhasesPipeline = jest.fn<(params: PipelineCall) => Promise<PipelineResult>>();

jest.mock('#src/phases/runPhasesPipeline.ts', () => ({ runPhasesPipeline: (params: PipelineCall) => mockRunPhasesPipeline(params) }));
// -------------------------
const mockRunImplementPipeline = jest.fn<(params: PipelineCall) => Promise<PipelineResult>>();

jest.mock('#src/pipeline/runImplementPipeline.ts', () => ({ runImplementPipeline: (params: PipelineCall) => mockRunImplementPipeline(params) }));
// -------------------------

const name = 'lo-154-queue-owns-the-build';

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const passedManifest: RunManifest = {
	runId: 'run-7',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:01.000Z',
	plan: join('.lightsout', 'work-orders', name, 'plans', 'plan.md'),
	harness: 'claude-code',
	status: RunStatus.Passed,
	currentStep: null,
	steps: [],
	changedFiles: [],
	commits: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
};

/**
 * A temporary checkout holding one plan folder, with both pipelines stubbed to
 * pass. `phased` adds the overview file that decides which of the two runs,
 * since the choice is read off the tree rather than told.
 *
 * Whichever runs opens one child on the level it was handed, so a build that
 * was handed no level writes no child — which is how a case reads back that
 * the level actually reached the pipeline rather than stopping at the wrapper.
 */
const setupQueueBuild = async ({ phased }: { phased: boolean }) => {
	const cwd = await freshCwd();
	const planDir = join(cwd, '.lightsout', 'work-orders', name, 'plans');

	await mkdir(planDir, { recursive: true });
	await writeFile(join(planDir, 'plan.md'), '# Plan\n', 'utf8');

	if (phased) {
		await writeFile(join(planDir, 'overview.md'), '# Overview\n', 'utf8');
	}

	const build = async ({ level }: PipelineCall): Promise<PipelineResult> => {
		level?.open({ level: ActivityLevelKind.Pass, label: 'the build' }).close({ outcome: RunStatus.Passed });

		return { ok: true, manifest: passedManifest };
	};

	mockRunPhasesPipeline.mockImplementation(build);
	mockRunImplementPipeline.mockImplementation(build);

	const onProgress = jest.fn<(message: string) => void>();

	return { cwd, planDir, onProgress };
};

describe('runPlanFolderPipeline', () => {
	test.each([{ phased: false }, { phased: true }])('a queue build records a command run under the plan it built', async ({ phased }) => {
		const { cwd, planDir, onProgress } = await setupQueueBuild({ phased });

		const outcome = await runPlanFolderPipeline({ cwd, name, config, driver, onProgress });

		const report = buildActivityTree({ plan: name, marks: await readActivityMarks({ dir: planDir }) });

		// the build the queue runs in-process is one command run, named for the
		// command a human would have typed for the same build, under the plan
		// level its planning already wrote into — and the build's own work hangs
		// from the level that command run handed it
		expect(report.roots).toEqual([
			expect.objectContaining({
				level: 'plan',
				label: name,
				startedAt: expect.any(String),
				endedAt: expect.any(String),
				children: [
					expect.objectContaining({
						level: 'command-run',
						label: 'implement',
						startedAt: expect.any(String),
						endedAt: expect.any(String),
						outcome: 'passed',
						children: [expect.objectContaining({ level: 'pass', label: 'the build' })],
					}),
				],
			}),
		]);
		// and the queue still reads the build the way it always has
		expect(outcome).toStrictEqual({});
	});
});
