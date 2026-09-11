import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { format } from 'node:util';
import { describe, expect, jest, test } from '@jest/globals';
import { type PlanningProgress, PlanningStep, type PlanningStepRecord, RunStatus } from '#src/contracts/index.ts';
import { recordPlanningStep } from '#src/plan/progress/index.ts';
import { freshCwd } from '#tests/helpers/freshCwd.ts';

// No module mocks: the recorder's whole job is a file in a plan folder, so each
// case arranges a real temporary checkout and reads the record back off disk.

/** What a subcommand's own work resolves to — its shape is the caller's business. */
interface WorkResult {
	converged: boolean;
}

const name = 'lo-136-queue-board';

const isoTime = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

const draftPassed: PlanningStepRecord = {
	step: 'draft',
	status: 'passed',
	attempts: 1,
	pid: 4242,
	startedAt: '2026-09-10T08:00:00.000Z',
	finishedAt: '2026-09-10T08:04:00.000Z',
	durationMs: 240_000,
};

const gradeFailed: PlanningStepRecord = {
	step: 'grade',
	status: 'failed',
	attempts: 1,
	pid: 4242,
	startedAt: '2026-09-10T08:05:00.000Z',
	finishedAt: '2026-09-10T08:09:00.000Z',
	durationMs: 240_000,
};

/** The record on disk, or undefined when there is none to read. */
const readRecord = async ({ path }: { path: string }): Promise<PlanningProgress | undefined> => {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch {
		return undefined;
	}
};

/**
 * A temp checkout, optionally holding the plan folder, a prior record or a
 * directory squatting on the record's path, plus a work that snapshots the
 * record on disk while it is still pending.
 */
const setupRecording = async ({
	planFolder = true,
	steps,
	recordPathTaken = false,
	workCreatesPlanFolder = false,
	workError,
	status = RunStatus.Passed,
}: {
	planFolder?: boolean;
	steps?: PlanningStepRecord[];
	recordPathTaken?: boolean;
	workCreatesPlanFolder?: boolean;
	workError?: Error;
	status?: RunStatus;
} = {}) => {
	const cwd = await freshCwd();
	const planDir = join(cwd, '.lightsout', 'plans', name);
	const recordPath = join(planDir, 'planning-progress.json');

	if (planFolder) {
		await mkdir(planDir, { recursive: true });
	}

	if (steps) {
		await writeFile(recordPath, `${JSON.stringify({ name, updatedAt: '2026-09-10T08:09:00.000Z', steps }, null, '\t')}\n`, 'utf8');
	}

	if (recordPathTaken) {
		await mkdir(recordPath, { recursive: true });
	}

	const workResult: WorkResult = { converged: true };
	const seenByWork: (PlanningProgress | undefined)[] = [];
	const work = jest.fn<() => Promise<WorkResult>>(async () => {
		if (workCreatesPlanFolder) {
			await mkdir(planDir, { recursive: true });
		}

		seenByWork.push(await readRecord({ path: recordPath }));

		if (workError) {
			throw workError;
		}

		return workResult;
	});
	const statusOf = jest.fn<(params: { result: WorkResult }) => RunStatus>().mockReturnValue(status);

	const logged: string[] = [];
	const errors: string[] = [];

	jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
		logged.push(format(...args));
	});
	jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		errors.push(format(...args));
	});

	return { cwd, recordPath, work, workResult, seenByWork, statusOf, logged, errors };
};

describe('recordPlanningStep', () => {
	test("records the step as running while the work runs, then as statusOf says, and returns the work's result", async () => {
		const { cwd, recordPath, work, workResult, seenByWork, statusOf } = await setupRecording({ status: RunStatus.PausedRateLimit });

		const result = await recordPlanningStep({ cwd, name, step: PlanningStep.Draft, work, statusOf });
		const recordAfter = await readRecord({ path: recordPath });

		expect(result).toBe(workResult);
		expect(statusOf).toHaveBeenCalledWith({ result: workResult });
		expect(seenByWork).toEqual([
			{
				name,
				updatedAt: isoTime,
				steps: [{ step: 'draft', status: 'running', attempts: 1, pid: process.pid, startedAt: isoTime }],
			},
		]);
		expect(recordAfter).toEqual({
			name,
			updatedAt: isoTime,
			steps: [
				{
					step: 'draft',
					status: 'paused-rate-limit',
					attempts: 1,
					pid: process.pid,
					startedAt: isoTime,
					finishedAt: isoTime,
					durationMs: expect.any(Number),
				},
			],
		});
		expect(recordAfter?.steps[0]?.durationMs).toBeGreaterThanOrEqual(0);
	});

	test("a second run of a step raises its attempts and leaves every other step's entry as it was", async () => {
		const { cwd, recordPath, work, statusOf } = await setupRecording({ steps: [draftPassed, gradeFailed] });

		await recordPlanningStep({ cwd, name, step: PlanningStep.Grade, work, statusOf });
		const recordAfter = await readRecord({ path: recordPath });

		expect(recordAfter?.steps).toEqual([
			{
				step: 'draft',
				status: 'passed',
				attempts: 1,
				pid: 4242,
				startedAt: '2026-09-10T08:00:00.000Z',
				finishedAt: '2026-09-10T08:04:00.000Z',
				durationMs: 240_000,
			},
			{
				step: 'grade',
				status: 'passed',
				attempts: 2,
				pid: process.pid,
				startedAt: isoTime,
				finishedAt: isoTime,
				durationMs: expect.any(Number),
			},
		]);
	});

	test('a work that throws is recorded as failed and the same error is rethrown', async () => {
		const workError = new Error('the dedup judge crashed');
		const { cwd, recordPath, work, statusOf } = await setupRecording({ workError });

		await expect(recordPlanningStep({ cwd, name, step: PlanningStep.Dedup, work, statusOf })).rejects.toBe(workError);
		const recordAfter = await readRecord({ path: recordPath });

		expect(recordAfter?.steps).toEqual([expect.objectContaining({ step: 'dedup', status: 'failed', attempts: 1, finishedAt: isoTime })]);
	});

	test('writes the record as tab-indented JSON with a trailing newline, leaving no temporary file beside it', async () => {
		const { cwd, recordPath, work, statusOf } = await setupRecording();

		await recordPlanningStep({ cwd, name, step: PlanningStep.Draft, work, statusOf });
		const recordText = await readFile(recordPath, 'utf8');
		const planFolderEntries = await readdir(dirname(recordPath));

		expect(recordText).toBe(`${JSON.stringify(JSON.parse(recordText), null, '\t')}\n`);
		expect(recordText).toMatch(/^\{\n\t"name": "lo-136-queue-board",\n/);
		expect(planFolderEntries).toStrictEqual(['planning-progress.json']);
	});

	test('writes nothing and creates no folder when the plan folder does not exist', async () => {
		const { cwd, work, workResult, statusOf, logged, errors } = await setupRecording({ planFolder: false });

		const result = await recordPlanningStep({ cwd, name, step: PlanningStep.Grade, work, statusOf });
		const cwdEntries = await readdir(cwd);

		expect(result).toBe(workResult);
		expect(work).toHaveBeenCalledTimes(1);
		expect(cwdEntries).toEqual([]);
		expect([...logged, ...errors]).toEqual([]);
	});

	test('a work that creates the plan folder still gets its finished entry written', async () => {
		const { cwd, recordPath, work, statusOf } = await setupRecording({ planFolder: false, workCreatesPlanFolder: true });

		await recordPlanningStep({ cwd, name, step: PlanningStep.VerifyFacts, work, statusOf });
		const recordAfter = await readRecord({ path: recordPath });

		expect(recordAfter).toEqual({
			name,
			updatedAt: isoTime,
			steps: [
				{
					step: 'verify-facts',
					status: 'passed',
					attempts: 1,
					pid: process.pid,
					startedAt: isoTime,
					finishedAt: isoTime,
					durationMs: expect.any(Number),
				},
			],
		});
	});

	test("a record write that fails prints one stderr line naming the record and still returns the work's result", async () => {
		const { cwd, recordPath, work, workResult, statusOf, errors } = await setupRecording({ recordPathTaken: true });

		const result = await recordPlanningStep({ cwd, name, step: PlanningStep.Publish, work, statusOf });

		expect(result).toBe(workResult);
		expect(errors).toEqual([expect.stringContaining(recordPath), expect.stringContaining(recordPath)]);
	});
});
