import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, jest, test } from '@jest/globals';
import { type ActivityLevel, buildActivityTree, readActivityMarks } from '#src/activity/index.ts';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { ActivityLevelKind, type LightsoutConfig, type RunManifest, RunStatus, type TicketRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import { TerminalQuestionRelay } from '#src/queue/relay/index.ts';
import { runWorkerWithRelay } from '#src/queue/workers/runWorkerWithRelay.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

/**
 * What the queue leaves in a plan folder's activity record when it builds that
 * plan itself.
 *
 * A sibling of `runWorkerWithRelay.planWorker.unit.test.ts` rather than more
 * cases in it: that file stubs the build to state which build a ticket gets,
 * while every case here runs the real in-process build so the record it writes
 * can be read back off the disk the way the report reads it. The two pipelines
 * the build chooses between are the only things stubbed, because each spawns a
 * harness and each is covered by its own tests.
 */

// Mocked Imports
// -------------------------
/** What either pipeline is handed. `level` is what the build hangs its own work from, and the paths are what the folder's shape chooses between. */
interface PipelineCall {
	cwd: string;
	config: LightsoutConfig;
	driver: Driver;
	runId: string;
	planPath?: string;
	overviewPath?: string;
	level?: ActivityLevel;
	onProgress?: (message: string) => void;
}

const mockRunImplementPipeline = jest.fn<(params: PipelineCall) => Promise<PipelineResult>>();

jest.mock('#src/pipeline/index.ts', () => ({
	runImplementPipeline: (params: PipelineCall) => mockRunImplementPipeline(params),
}));
// -------------------------
const mockRunPhasesPipeline = jest.fn<(params: PipelineCall) => Promise<PipelineResult>>();

jest.mock('#src/phases/index.ts', () => ({
	runPhasesPipeline: (params: PipelineCall) => mockRunPhasesPipeline(params),
}));
// -------------------------
// Only the record pull is stubbed: the lifecycle helper around the build stays
// real, so each case runs the build through the same wrapper the queue does.
interface PullTicketRecordParams {
	cwd: string;
	ticketBranch: string;
	config: LightsoutConfig;
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

type PullTicketRecordResult = { record: TicketRecord | undefined } | { error: string };

const mockPullTicketRecord = jest.fn<(params: PullTicketRecordParams) => Promise<PullTicketRecordResult>>();

jest.mock('#src/ticket/index.ts', () => ({
	...jest.requireActual<typeof import('#src/ticket/index.ts')>('#src/ticket/index.ts'),
	pullTicketRecord: (params: PullTicketRecordParams) => mockPullTicketRecord(params),
}));
// -------------------------

const branch = 'lo-70-drain';
const settings = queueSettingsFixture();

const config: LightsoutConfig = { gates: { check: 'true', test: 'true', 'test-coverage': false } };
const driver: Driver = { name: 'claude-code', invoke: () => Promise.resolve({ text: '', exitCode: 0 }) };

const ticket: RunnableTicket = {
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	url: 'https://linear.app/lightsout/issue/LO-70',
	description: 'Build the thing.',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels: [],
	planningStatus: PlanningStatus.NotNeeded,
	worker: QueueWorker.Plan,
	status: 'Ready to implement',
	finished: false,
	unfinishedBlockers: [],
};

const manifestOf = ({ status }: { status: RunStatus }): RunManifest => ({
	runId: 'run-7',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:01.000Z',
	plan: join('.lightsout', 'plans', branch, 'plan.md'),
	harness: 'claude-code',
	status,
	currentStep: null,
	steps: [],
	changedFiles: [],
	packages: [],
	baselineDirtyFiles: [],
	testSubjects: [],
	acceptanceTests: [],
	approvedTests: [],
	unreachableChangedFiles: [],
	coverageExcludedChangedFiles: [],
});

/**
 * A queue worktree holding the branch's own plan folder, with a ticket that
 * carries no record — the shape that sends the worker straight to the
 * in-process build of that one folder.
 *
 * `phased` writes the overview file the build reads to choose between the two
 * pipelines, and `result` is what whichever one runs answers with. Both stubs
 * open a child on the level they are handed, so a case reads back from the
 * record whether the level reached the pipeline or stopped at the wrapper.
 */
const setupQueueBuild = ({ phased = false, result }: { phased?: boolean; result: PipelineResult }) => {
	const worktreePath = mkdtempSync(join(tmpdir(), 'lightsout-queue-activity-'));
	const planDir = join(worktreePath, '.lightsout', 'plans', branch);

	mkdirSync(planDir, { recursive: true });
	writeFileSync(join(planDir, 'plan.md'), '# Plan\n');

	if (phased) {
		writeFileSync(join(planDir, 'overview.md'), '# Overview\n');
	}

	mockPullTicketRecord.mockResolvedValue({ record: undefined });

	const build = async ({ level }: PipelineCall): Promise<PipelineResult> => {
		level?.open({ level: ActivityLevelKind.Pass, label: 'the build' }).close({ outcome: result.manifest.status });

		return result;
	};

	mockRunImplementPipeline.mockImplementation(build);
	mockRunPhasesPipeline.mockImplementation(build);

	const coordinatorRunDir = mkdtempSync(join(tmpdir(), 'lightsout-queue-coordinator-'));
	const input = new PassThrough();
	const output = new Writable({
		write(_chunk: Buffer, _encoding, done) {
			done();
		},
	});
	// No case here escalates, so nothing is ever typed back on these streams.
	const relay = new TerminalQuestionRelay({ settings, trackerSettings: trackerSettingsFixture(), input, output });

	return {
		relay,
		planDir,
		params: {
			worktreePath,
			branch,
			ticket,
			config,
			driver,
			driverName: 'claude-code',
			settings,
			trackerSettings: trackerSettingsFixture(),
			relay,
			coordinatorRunId: 'run-q',
			coordinatorRunDir,
			ticketRunDir: join(coordinatorRunDir, 'tickets', 'LO-70'),
			env: { LINEAR_API_KEY: 'key-1' },
		},
	};
};

describe('runWorkerWithRelay', () => {
	test.each([
		{ phased: false, shape: 'a single plan' },
		{ phased: true, shape: 'a phased folder' },
	])('runWorkerWithRelay: the queue building $shape records a command run labelled implement under the plan', async ({ phased }) => {
		const { relay, planDir, params } = setupQueueBuild({ phased, result: { ok: true, manifest: manifestOf({ status: RunStatus.Passed }) } });

		const outcome = await runWorkerWithRelay(params);

		relay.close();

		const report = buildActivityTree({ plan: branch, marks: await readActivityMarks({ dir: planDir }) });

		// the build the queue runs in-process is one command run, named for the
		// command a human would have typed for the same build, under the plan
		// level its planning already wrote into — and the build's own work hangs
		// from the level that command run handed it
		expect(report.roots).toEqual([
			expect.objectContaining({
				level: 'plan',
				label: branch,
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

	test('runWorkerWithRelay: a queue build that fails closes its command run failed and still states the resume', async () => {
		const failed = { ok: false, error: 'the test gate stayed red', manifest: manifestOf({ status: RunStatus.Failed }) };
		const { relay, planDir, params } = setupQueueBuild({ result: failed });

		const outcome = await runWorkerWithRelay(params);

		relay.close();

		const report = buildActivityTree({ plan: branch, marks: await readActivityMarks({ dir: planDir }) });

		expect(report.roots).toEqual([
			expect.objectContaining({
				level: 'plan',
				label: branch,
				outcome: 'failed',
				children: [expect.objectContaining({ level: 'command-run', label: 'implement', outcome: 'failed' })],
			}),
		]);
		expect(outcome).toStrictEqual({ error: 'the test gate stayed red — `lightsout resume --run run-7` continues it from the worktree' });
	});
});
