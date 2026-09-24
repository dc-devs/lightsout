import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { PlanProgress, RunStatus, WorkOrderMode, type WorkOrderPlan, type WorkOrderState } from '#src/contracts/index.ts';
import type { PipelineResult } from '#src/pipeline/index.ts';
import { runWorkOrderBodyBuildLifecycle, updateLocalWorkOrderState } from '#src/workOrder/index.ts';
import { manifestOf, planOf } from '#tests/helpers/setupTicketPlanLifecycle.ts';

const workOrderName = 'lo-166-planless';
const isoTime = /^\d{4}-\d{2}-\d{2}T/;

type TicketBodyBuild = NonNullable<WorkOrderState['ticketBodyBuild']>;

interface BodyBuildSetup {
	/** What sits at `state.json`: a record the store wrote, bytes that are not a record, or nothing at all. */
	stored?: 'record' | 'corrupt' | 'none';
	mode?: WorkOrderMode;
	plans?: WorkOrderPlan[];
	/** An earlier build from the ticket body the record already carries. */
	ticketBodyBuild?: TicketBodyBuild;
	/** The status the run's manifest ends at. */
	status?: RunStatus;
	/** Runs the moment the build starts — how a row deletes the record out from under a finishing run. */
	onRun?: (context: { recordPath: string }) => void;
}

/**
 * A checkout outside any repository, so the work order's folder is this
 * directory's own `.lightsout/work-orders/<label>`, with a record written by the
 * store itself where the row asks for one, and a run that notes the id it was
 * handed and the record as it stood when the build started.
 */
const setupBodyBuild = async ({
	stored = 'record',
	mode = WorkOrderMode.SinglePlan,
	plans = [],
	ticketBodyBuild,
	status = RunStatus.Passed,
	onRun,
}: BodyBuildSetup = {}) => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-body-build-lifecycle-'));
	const workOrderFolder = join(cwd, '.lightsout', 'work-orders', workOrderName);
	const recordPath = join(workOrderFolder, 'state.json');

	if (stored === 'record') {
		await updateLocalWorkOrderState({
			cwd,
			name: workOrderName,
			change: () => ({
				schemaVersion: 1,
				name: workOrderName,
				ticketRef: 'LO-166',
				branch: workOrderName,
				mode,
				plans,
				...(ticketBodyBuild === undefined ? {} : { ticketBodyBuild }),
				history: [],
			}),
		});
	}

	if (stored === 'corrupt') {
		mkdirSync(workOrderFolder, { recursive: true });
		writeFileSync(recordPath, '{ half a record');
	}

	const readRecord = () => JSON.parse(readFileSync(recordPath, 'utf8')) as WorkOrderState;
	const readBytes = () => (existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : undefined);
	const seenRunIds: string[] = [];
	/** The record as it stood the moment the build started, which is what "before the run" is asserted against. */
	const recordsAtRunStart: (WorkOrderState | undefined)[] = [];
	const run = ({ runId }: { runId: string }): Promise<PipelineResult> => {
		seenRunIds.push(runId);
		recordsAtRunStart.push(existsSync(recordPath) ? readRecord() : undefined);
		onRun?.({ recordPath });

		return Promise.resolve({
			ok: status === RunStatus.Passed,
			manifest: manifestOf({ name: workOrderName, runId, status, plan: `.lightsout/work-orders/${workOrderName}/ticket.md` }),
		});
	};

	return { cwd, recordPath, seenRunIds, recordsAtRunStart, run, readRecord, bytesBefore: readBytes(), readBytes };
};

describe('runWorkOrderBodyBuildLifecycle', () => {
	test('records the build from the ticket body implementing under the run id it hands the run before the run starts', async () => {
		const { cwd, seenRunIds, recordsAtRunStart, run } = await setupBodyBuild();

		await runWorkOrderBodyBuildLifecycle({ cwd, workOrderName, run });

		expect({ runIds: seenRunIds, atRunStart: recordsAtRunStart[0]?.ticketBodyBuild }).toEqual({
			runIds: [expect.stringMatching(/\S/)],
			atRunStart: { runId: seenRunIds[0], progress: 'implementing', startedAt: expect.stringMatching(isoTime) },
		});
	});

	test.each([
		{ status: RunStatus.Passed, progress: 'implemented' },
		{ status: RunStatus.Failed, progress: 'failed' },
		{ status: RunStatus.Escalated, progress: 'failed' },
	])('records a passed build implemented and a failed or escalated build failed, each with its finish time', async ({ status, progress }) => {
		const { cwd, seenRunIds, run, readRecord } = await setupBodyBuild({ status });

		const outcome = await runWorkOrderBodyBuildLifecycle({ cwd, workOrderName, run });
		const record = readRecord();

		expect(outcome).toEqual({
			result: {
				ok: status === RunStatus.Passed,
				manifest: manifestOf({ name: workOrderName, runId: seenRunIds[0] ?? '', status, plan: `.lightsout/work-orders/${workOrderName}/ticket.md` }),
			},
		});
		expect(record.ticketBodyBuild).toEqual({
			runId: seenRunIds[0],
			progress,
			startedAt: expect.stringMatching(isoTime),
			finishedAt: expect.stringMatching(isoTime),
		});
	});

	test('leaves the build implementing when the run pauses', async () => {
		const { cwd, seenRunIds, run, readRecord } = await setupBodyBuild({ status: RunStatus.PausedRateLimit });

		await runWorkOrderBodyBuildLifecycle({ cwd, workOrderName, run });
		const record = readRecord();

		expect(record.ticketBodyBuild).toEqual({
			runId: seenRunIds[0],
			progress: 'implementing',
			startedAt: expect.stringMatching(isoTime),
		});
	});

	test('replaces an earlier build from the ticket body with the new run', async () => {
		const { cwd, seenRunIds, run, readRecord } = await setupBodyBuild({
			ticketBodyBuild: {
				runId: 'run-old',
				progress: PlanProgress.Failed,
				startedAt: '2026-02-01T00:00:00.000Z',
				finishedAt: '2026-02-01T00:30:00.000Z',
			},
		});

		await runWorkOrderBodyBuildLifecycle({ cwd, workOrderName, run });
		const record = readRecord();

		expect(seenRunIds).toEqual([expect.not.stringMatching(/^run-old$/)]);
		expect(record.ticketBodyBuild).toEqual({
			runId: seenRunIds[0],
			progress: 'implemented',
			startedAt: expect.not.stringMatching(/^2026-02-01T00:00:00\.000Z$/),
			finishedAt: expect.stringMatching(isoTime),
		});
	});

	test.each([
		{ stored: 'none', mode: WorkOrderMode.SinglePlan, plans: [] },
		{ stored: 'record', mode: WorkOrderMode.MultiplePlan, plans: [] },
		{ stored: 'record', mode: WorkOrderMode.SinglePlan, plans: [planOf({ id: '001-lifecycle', progress: PlanProgress.Ready })] },
	] as const)(
		'runs the build unchanged and writes nothing for no record, a multiple-plan record or a record holding plan 001',
		async ({ stored, mode, plans }) => {
			const { cwd, seenRunIds, run, bytesBefore, readBytes } = await setupBodyBuild({ stored, mode, plans: [...plans] });

			const outcome = await runWorkOrderBodyBuildLifecycle({ cwd, workOrderName, run });

			expect(outcome).toEqual({ result: expect.objectContaining({ ok: true }) });
			expect(seenRunIds).toEqual([expect.stringMatching(/\S/)]);
			expect(readBytes()).toBe(bytesBefore);
		},
	);

	test.each([
		{
			setup: { stored: 'corrupt' },
			expectedOutcome: { refusal: expect.stringMatching(/\S/) },
			expectedRunCount: 0,
		},
		{
			setup: { onRun: ({ recordPath }: { recordPath: string }) => rmSync(recordPath) },
			expectedOutcome: { result: expect.objectContaining({ ok: true }), recordError: expect.stringMatching(/\S/) },
			expectedRunCount: 1,
		},
	] as const)(
		'refuses an unreadable record before the run and returns a record error beside the result when the record is gone after it',
		async ({ setup, expectedOutcome, expectedRunCount }) => {
			const { cwd, seenRunIds, run } = await setupBodyBuild(setup);

			const outcome = await runWorkOrderBodyBuildLifecycle({ cwd, workOrderName, run });

			expect(outcome).toEqual(expectedOutcome);
			expect(seenRunIds).toHaveLength(expectedRunCount);
		},
	);
});
