import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { workOrderFolderDir } from '#src/common/workspace/workOrderFolderDir.ts';
import { RunStatus } from '#src/contracts/run/RunStatus.ts';
import { PlanProgress } from '#src/contracts/workOrder/PlanProgress.ts';
import type { WorkOrderState } from '#src/contracts/workOrder/WorkOrderState.ts';
import { runWorkOrderPlanLifecycle } from '#src/workOrder/implementRun/runWorkOrderPlanLifecycle.ts';
import { updateLocalWorkOrderState } from '#src/workOrder/updateLocalWorkOrderState.ts';
import {
	address,
	decisionsBody,
	firstPlan,
	headCommit,
	type MockedReadGitHeadCommit,
	manifestOf,
	otherMachineMarker,
	planBody,
	planOf,
	secondPlan,
	setupTicketPlanLifecycle,
	startCommit,
	workOrderName,
} from '#tests/helpers/setupTicketPlanLifecycle.ts';

// Mocked Imports
// -------------------------
// Git is the one seam. The commit a plan's implementation starts from is read
// out of the checkout, and the rows below need it to be a value they can name
// and to have moved since an earlier run failed. Everything else — the record,
// the sync sidecar and the plan's own files — is a real file in a temporary
// directory, because what this helper promises is about which bytes reach disk
// and when.
const mockReadGitHeadCommit: MockedReadGitHeadCommit = jest.fn();

jest.mock('#src/common/git/readGitHeadCommit.ts', () => ({
	readGitHeadCommit: (params: { cwd: string }) => mockReadGitHeadCommit(params),
}));
// -------------------------

/**
 * A ticket whose sidecar inside its OWN folder agrees with the record, and a
 * stale sidecar in the pre-layout plans folder that names no marker at all.
 *
 * The two answers are opposite on purpose: read from the work order's folder the
 * plan is in step and the run goes ahead, and read from the pre-layout folder
 * the plan looks published elsewhere and the lifecycle refuses before the
 * pipeline is ever called.
 */
const setupTicketFolderSyncState = async () => {
	const context = await setupTicketPlanLifecycle({
		mockReadGitHeadCommit,
		plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready, publishedMarker: otherMachineMarker })],
		manifestPlan: `.lightsout/work-orders/${workOrderName}/plans/${firstPlan}/plan.md`,
	});
	const workOrderFolder = join(context.cwd, '.lightsout', 'work-orders', workOrderName);
	const preLayoutFolder = join(context.cwd, '.lightsout', 'plans', workOrderName);

	mkdirSync(workOrderFolder, { recursive: true });
	writeFileSync(join(workOrderFolder, 'state-sync.json'), JSON.stringify({ schemaVersion: 1, planMarkers: { [firstPlan]: otherMachineMarker } }));
	mkdirSync(preLayoutFolder, { recursive: true });
	writeFileSync(join(preLayoutFolder, 'state-sync.json'), JSON.stringify({ schemaVersion: 1, planMarkers: {} }));

	return {
		...context,
		readTicketFolderRecord: () => JSON.parse(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')) as WorkOrderState,
	};
};

/**
 * A work order holding one ready plan, asked for by its plan address, with a
 * whole plan in the folder so the run is a whole-plan pass.
 *
 * The state file is read back from the work order's own folder rather than from
 * a path the fixture hands out, so the row states the file name itself.
 */
const setupWholePlanRun = async () => {
	const context = await setupTicketPlanLifecycle({
		mockReadGitHeadCommit,
		plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
	});
	const workOrderFolder = await workOrderFolderDir({ cwd: context.cwd, name: workOrderName });

	return {
		...context,
		readStateFile: () => JSON.parse(readFileSync(join(workOrderFolder, 'state.json'), 'utf8')) as WorkOrderState,
		hasLegacyRecordFile: () => existsSync(join(workOrderFolder, 'ticket.json')),
	};
};

describe('runWorkOrderPlanLifecycle: what the run leaves on the plan', () => {
	test('runWorkOrderPlanLifecycle: records progress around the run in state.json', async () => {
		const { cwd, name, run, recordsAtRunStart, readStateFile, hasLegacyRecordFile } = await setupWholePlanRun();

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ result: expect.objectContaining({ ok: true }) });
		expect({
			atRunStart: recordsAtRunStart[0]?.plans[0]?.progress,
			afterTheRun: readStateFile().plans[0]?.progress,
			legacyRecordFileWritten: hasLegacyRecordFile(),
		}).toStrictEqual({
			atRunStart: 'implementing',
			afterTheRun: 'implemented',
			legacyRecordFileWritten: false,
		});
	});

	test("runs a legacy plan folder's pipeline unchanged and writes no work order state", async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({ mockReadGitHeadCommit, name: workOrderName });

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(seenRunIds).toEqual([expect.stringMatching(/\S/)]);
		expect(outcome).toEqual({
			result: { ok: true, manifest: manifestOf({ name: workOrderName, runId: seenRunIds[0], status: RunStatus.Passed }) },
		});
		expect(existsSync(recordPath)).toBe(false);
	});

	test('runs a plan address whose ticket has no record unchanged and creates none', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({ mockReadGitHeadCommit });

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(seenRunIds).toEqual([expect.stringMatching(/\S/)]);
		expect(outcome).toEqual({ result: { ok: true, manifest: manifestOf({ name: address, runId: seenRunIds[0], status: RunStatus.Passed }) } });
		expect(existsSync(recordPath)).toBe(false);
	});

	test('records the plan implementing under the run id it hands the pipeline, with the start time and HEAD commit, before the pipeline runs', async () => {
		const { cwd, name, seenRunIds, recordsAtRunStart, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
		});

		await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(recordsAtRunStart[0]?.plans[0]).toEqual({
			id: firstPlan,
			title: `plan ${firstPlan}`,
			progress: 'implementing',
			createdAt: '2026-01-01T00:00:00.000Z',
			implementation: { runId: seenRunIds[0], startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), startCommit: headCommit },
		});
	});

	test('records a passed run implemented with its finish time and a snapshot of every durable plan file', async () => {
		const { cwd, name, run, readRecord } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
		});

		await runWorkOrderPlanLifecycle({ cwd, name, run });
		const record = readRecord();

		expect(record.plans[0]).toEqual(
			expect.objectContaining({
				progress: 'implemented',
				implementation: expect.objectContaining({
					finishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
					snapshot: [
						{ name: 'plan.md', sha256: sha256({ content: planBody }) },
						{ name: 'decisions.json', sha256: sha256({ content: decisionsBody }) },
					],
				}),
			}),
		);
	});

	test('leaves the plan implementing when only one phase file of it ran and passed', async () => {
		const { cwd, name, seenRunIds, run, readRecord } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			folder: 'phased',
			manifestPlan: `.lightsout/work-orders/${address}/plans/phase1-lifecycle.md`,
		});

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });
		const record = readRecord();

		expect(outcome).toEqual({ result: expect.objectContaining({ ok: true }), note: expect.stringMatching(/\S/) });
		expect(outcome).toEqual({ result: expect.anything(), note: expect.not.stringMatching(/unfinished/i) });
		expect(record.plans[0]?.progress).toBe('implementing');
		expect(record.plans[0]?.implementation).toEqual({
			runId: seenRunIds[0],
			startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
			startCommit: headCommit,
		});
	});

	test('records a failed or an escalated run as failed without a finish time or snapshot', async () => {
		const failed = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			status: RunStatus.Failed,
		});
		const escalated = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			status: RunStatus.Escalated,
		});

		await runWorkOrderPlanLifecycle({ cwd: failed.cwd, name: failed.name, run: failed.run });
		await runWorkOrderPlanLifecycle({ cwd: escalated.cwd, name: escalated.name, run: escalated.run });

		expect(failed.readRecord().plans[0]).toEqual(
			expect.objectContaining({
				progress: 'failed',
				implementation: { runId: failed.seenRunIds[0], startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), startCommit: headCommit },
			}),
		);
		expect(escalated.readRecord().plans[0]).toEqual(
			expect.objectContaining({
				progress: 'failed',
				implementation: { runId: escalated.seenRunIds[0], startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), startCommit: headCommit },
			}),
		);
	});

	test('leaves the plan implementing when the run pauses', async () => {
		const { cwd, name, seenRunIds, run, readRecord } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			status: RunStatus.PausedRateLimit,
		});

		await runWorkOrderPlanLifecycle({ cwd, name, run });
		const record = readRecord();

		expect(record.plans[0]).toEqual(
			expect.objectContaining({
				progress: 'implementing',
				implementation: { runId: seenRunIds[0], startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), startCommit: headCommit },
			}),
		);
	});

	test("keeps the recorded start time and commit when a failed plan's implementation is resumed", async () => {
		const { cwd, name, seenRunIds, recordsAtRunStart, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [
				planOf({
					id: firstPlan,
					progress: PlanProgress.Failed,
					implementation: { runId: 'run-earlier', startedAt: '2026-02-01T00:00:00.000Z', startCommit },
				}),
			],
		});

		await runWorkOrderPlanLifecycle({ cwd, name, resumeRunId: 'run-earlier', run });

		expect(seenRunIds).toStrictEqual(['run-earlier']);
		expect(recordsAtRunStart[0]?.plans[0]).toEqual(
			expect.objectContaining({
				progress: 'implementing',
				implementation: { runId: 'run-earlier', startedAt: '2026-02-01T00:00:00.000Z', startCommit },
			}),
		);
	});

	test("returns the run's result with a record error when the work order state is gone once the run ends", async () => {
		const { cwd, name, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			onRun: ({ recordPath }) => rmSync(recordPath),
		});

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({
			result: { ok: true, manifest: manifestOf({ name: address, runId: seenRunIds[0], status: RunStatus.Passed }) },
			recordError: expect.stringMatching(/\S/),
		});
	});
});

describe('runWorkOrderPlanLifecycle: the plans it will not build', () => {
	test('refuses a plan whose published files moved on another machine since this machine last synced them', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready, publishedMarker: otherMachineMarker })],
			planMarkers: {},
		});
		const before = readFileSync(recordPath, 'utf8');

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ refusal: expect.stringContaining(firstPlan) });
		expect(outcome).toEqual({ refusal: expect.stringContaining('lightsout work-order sync') });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('runWorkOrderPlanLifecycle: the divergence refusal spells the work-order command word', async () => {
		const { cwd, name, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready, publishedMarker: otherMachineMarker })],
			planMarkers: {},
		});

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		// both halves of the remedy are one sentence: the published copy is taken
		// by name, and the local one is published over it by the bare `--keep local`
		expect(outcome).toEqual({ refusal: expect.stringContaining(`lightsout work-order sync --name ${workOrderName} --keep published`) });
		expect(outcome).toEqual({ refusal: expect.stringContaining('--keep local') });
		expect(outcome).toEqual({ refusal: expect.not.stringContaining('lightsout ticket sync') });
		expect(seenRunIds).toStrictEqual([]);
	});

	test('refuses a plan whose lower-numbered plan is not implemented without running it or changing the record', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			name: `${workOrderName}/${secondPlan}`,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Ready })],
		});
		const before = readFileSync(recordPath, 'utf8');

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ refusal: expect.stringContaining(firstPlan) });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses to run the plan at all when the work order state cannot be read', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			corrupt: true,
		});
		const before = readFileSync(recordPath, 'utf8');

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		// a record nobody can read is not a legacy folder: running anyway would
		// build the plan and record nothing about it, which the ship guard would
		// later read as a plan whose implementation never began
		expect(outcome).toEqual({ refusal: expect.stringContaining('state.json') });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses at the locked write when the plan was excluded while this run was starting', async () => {
		const { cwd, name, seenRunIds, run, readRecord } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			onStart: async ({ cwd: checkout }) => {
				await updateLocalWorkOrderState({
					cwd: checkout,
					name: workOrderName,
					change: (current) =>
						current === undefined
							? { error: 'the row seeded a record' }
							: {
									...current,
									plans: current.plans.map((plan) => ({
										...plan,
										exclusion: { at: '2026-03-01T00:00:00.000Z', reason: 'superseded by the queue rewrite', implementationRemoved: false },
									})),
								},
				});
			},
		});

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		// the order rules are asked again inside the lock, so a record another
		// command changed since the first read decides this run rather than the
		// copy the first read saw
		expect(outcome).toEqual({ refusal: expect.stringContaining('superseded by the queue rewrite') });
		expect(seenRunIds).toStrictEqual([]);
		expect(readRecord().plans[0]?.progress).toBe('ready');
	});

	test('refuses at the locked write when the work order state was removed while this run was starting', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			onStart: async ({ recordPath: path }) => {
				rmSync(path);
			},
		});

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ refusal: expect.stringContaining(firstPlan) });
		expect(seenRunIds).toStrictEqual([]);
		expect(existsSync(recordPath)).toBe(false);
	});

	test("refuses to start when git cannot name the commit the plan's implementation starts from", async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			head: undefined,
		});
		const before = readFileSync(recordPath, 'utf8');

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ refusal: expect.stringMatching(/\S/) });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});
});

describe("runWorkOrderPlanLifecycle: the folder the ticket's state is read from", () => {
	test("runWorkOrderPlanLifecycle: the ticket's sync state is read from the ticket's own folder", async () => {
		const { cwd, name, run, seenRunIds, readTicketFolderRecord } = await setupTicketFolderSyncState();

		const outcome = await runWorkOrderPlanLifecycle({ cwd, name, run });
		const record = readTicketFolderRecord();

		expect(outcome).toEqual({ result: expect.objectContaining({ ok: true }) });
		expect(seenRunIds).toEqual([expect.stringMatching(/\S/)]);
		expect(record.plans[0]).toEqual(
			expect.objectContaining({
				progress: 'implemented',
				implementation: expect.objectContaining({ runId: seenRunIds[0], startCommit: headCommit }),
			}),
		);
	});
});
