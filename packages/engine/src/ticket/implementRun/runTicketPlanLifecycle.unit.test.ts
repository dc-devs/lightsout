import { existsSync, readFileSync, rmSync } from 'node:fs';
import { describe, expect, jest, test } from '@jest/globals';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanProgress, RunStatus } from '#src/contracts/index.ts';
import { runTicketPlanLifecycle, updateLocalTicketRecord } from '#src/ticket/index.ts';
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
	ticketBranch,
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

describe('runTicketPlanLifecycle: what the run leaves on the plan', () => {
	test("runs a legacy plan folder's pipeline unchanged and writes no ticket record", async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({ mockReadGitHeadCommit, name: ticketBranch });

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		expect(seenRunIds).toEqual([expect.stringMatching(/\S/)]);
		expect(outcome).toEqual({
			result: { ok: true, manifest: manifestOf({ name: ticketBranch, runId: seenRunIds[0], status: RunStatus.Passed }) },
		});
		expect(existsSync(recordPath)).toBe(false);
	});

	test('runs a plan address whose ticket has no record unchanged and creates none', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({ mockReadGitHeadCommit });

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		expect(seenRunIds).toEqual([expect.stringMatching(/\S/)]);
		expect(outcome).toEqual({ result: { ok: true, manifest: manifestOf({ name: address, runId: seenRunIds[0], status: RunStatus.Passed }) } });
		expect(existsSync(recordPath)).toBe(false);
	});

	test('records the plan implementing under the run id it hands the pipeline, with the start time and HEAD commit, before the pipeline runs', async () => {
		const { cwd, name, seenRunIds, recordsAtRunStart, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
		});

		await runTicketPlanLifecycle({ cwd, name, run });

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

		await runTicketPlanLifecycle({ cwd, name, run });
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
			manifestPlan: `.lightsout/plans/${address}/phase1-lifecycle.md`,
		});

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });
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

		await runTicketPlanLifecycle({ cwd: failed.cwd, name: failed.name, run: failed.run });
		await runTicketPlanLifecycle({ cwd: escalated.cwd, name: escalated.name, run: escalated.run });

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

		await runTicketPlanLifecycle({ cwd, name, run });
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

		await runTicketPlanLifecycle({ cwd, name, resumeRunId: 'run-earlier', run });

		expect(seenRunIds).toStrictEqual(['run-earlier']);
		expect(recordsAtRunStart[0]?.plans[0]).toEqual(
			expect.objectContaining({
				progress: 'implementing',
				implementation: { runId: 'run-earlier', startedAt: '2026-02-01T00:00:00.000Z', startCommit },
			}),
		);
	});

	test("returns the run's result with a record error when the ticket record is gone once the run ends", async () => {
		const { cwd, name, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			onRun: ({ recordPath }) => rmSync(recordPath),
		});

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({
			result: { ok: true, manifest: manifestOf({ name: address, runId: seenRunIds[0], status: RunStatus.Passed }) },
			recordError: expect.stringMatching(/\S/),
		});
	});
});

describe('runTicketPlanLifecycle: the plans it will not build', () => {
	test('refuses a plan whose published files moved on another machine since this machine last synced them', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready, publishedMarker: otherMachineMarker })],
			planMarkers: {},
		});
		const before = readFileSync(recordPath, 'utf8');

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ refusal: expect.stringContaining(firstPlan) });
		expect(outcome).toEqual({ refusal: expect.stringContaining('lightsout ticket sync') });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses a plan whose lower-numbered plan is not implemented without running it or changing the record', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			name: `${ticketBranch}/${secondPlan}`,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready }), planOf({ id: secondPlan, progress: PlanProgress.Ready })],
		});
		const before = readFileSync(recordPath, 'utf8');

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ refusal: expect.stringContaining(firstPlan) });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses to run the plan at all when the ticket record cannot be read', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			corrupt: true,
		});
		const before = readFileSync(recordPath, 'utf8');

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		// a record nobody can read is not a legacy folder: running anyway would
		// build the plan and record nothing about it, which the ship guard would
		// later read as a plan whose implementation never began
		expect(outcome).toEqual({ refusal: expect.stringContaining('ticket.json') });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});

	test('refuses at the locked write when the plan was excluded while this run was starting', async () => {
		const { cwd, name, seenRunIds, run, readRecord } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			onStart: async ({ cwd: checkout }) => {
				await updateLocalTicketRecord({
					cwd: checkout,
					ticketBranch,
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

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		// the order rules are asked again inside the lock, so a record another
		// command changed since the first read decides this run rather than the
		// copy the first read saw
		expect(outcome).toEqual({ refusal: expect.stringContaining('superseded by the queue rewrite') });
		expect(seenRunIds).toStrictEqual([]);
		expect(readRecord().plans[0]?.progress).toBe('ready');
	});

	test('refuses at the locked write when the ticket record was removed while this run was starting', async () => {
		const { cwd, name, recordPath, seenRunIds, run } = await setupTicketPlanLifecycle({
			mockReadGitHeadCommit,
			plans: [planOf({ id: firstPlan, progress: PlanProgress.Ready })],
			onStart: async ({ recordPath: path }) => {
				rmSync(path);
			},
		});

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

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

		const outcome = await runTicketPlanLifecycle({ cwd, name, run });

		expect(outcome).toEqual({ refusal: expect.stringMatching(/\S/) });
		expect(seenRunIds).toStrictEqual([]);
		expect(readFileSync(recordPath, 'utf8')).toBe(before);
	});
});
