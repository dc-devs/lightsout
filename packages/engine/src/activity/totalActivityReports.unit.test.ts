import { describe, expect, test } from '@jest/globals';
import { buildActivityTree, totalActivityReports } from '#src/activity/index.ts';
import {
	type ActivityLevelEnd,
	ActivityLevelKind,
	type ActivityLevelStart,
	ActivityMarkKind,
	type ActivityReport,
	type HarnessProcessMark,
	type HarnessProcessUsage,
	ProcessEndReason,
	RunStatus,
} from '#src/contracts/index.ts';

/** One level opening, carrying only what a case varies. */
const levelStart = ({ id, at }: { id: string; at: string }): ActivityLevelStart => ({
	kind: ActivityMarkKind.LevelStart,
	id,
	level: ActivityLevelKind.CommandRun,
	label: id,
	at,
});

/** One level closing. Every case here settles the same way. */
const levelEnd = ({ id, at }: { id: string; at: string }): ActivityLevelEnd => ({
	kind: ActivityMarkKind.LevelEnd,
	id,
	at,
	outcome: RunStatus.Passed,
});

/** One harness process inside a level — the only thing that carries spend or agent time. */
const harnessProcess = ({
	levelId,
	startedAt,
	endedAt,
	usage,
}: {
	levelId: string;
	startedAt: string;
	endedAt: string;
	usage?: HarnessProcessUsage;
}): HarnessProcessMark => ({
	kind: ActivityMarkKind.HarnessProcess,
	levelId,
	harness: 'stub',
	spawn: 1,
	reemit: false,
	startedAt,
	endedAt,
	endReason: ProcessEndReason.Completed,
	usage,
});

/**
 * Two plans of one ticket whose processes run across each other in time.
 *
 * Each plan peaks at two processes of its own, and three are running at once
 * between three and four seconds in — so a ticket peak of three is neither the
 * two peaks added (four) nor the larger of them (two). Their busy stretches
 * touch as well: six seconds each, but nine seconds of wall clock in which any
 * agent at all was running.
 */
const setupOverlappingPlans = () => ({
	reports: [
		buildActivityTree({
			plan: 'my-ticket/plan-1',
			marks: [
				levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
				harnessProcess({ levelId: 'run-1', startedAt: '2026-09-17T00:00:00.000Z', endedAt: '2026-09-17T00:00:06.000Z' }),
				harnessProcess({ levelId: 'run-1', startedAt: '2026-09-17T00:00:02.000Z', endedAt: '2026-09-17T00:00:04.000Z' }),
				levelEnd({ id: 'run-1', at: '2026-09-17T00:00:10.000Z' }),
			],
		}),
		buildActivityTree({
			plan: 'my-ticket/plan-2',
			marks: [
				levelStart({ id: 'run-2', at: '2026-09-17T00:00:03.000Z' }),
				harnessProcess({ levelId: 'run-2', startedAt: '2026-09-17T00:00:03.000Z', endedAt: '2026-09-17T00:00:09.000Z' }),
				harnessProcess({ levelId: 'run-2', startedAt: '2026-09-17T00:00:07.000Z', endedAt: '2026-09-17T00:00:09.000Z' }),
				levelEnd({ id: 'run-2', at: '2026-09-17T00:00:12.000Z' }),
			],
		}),
	],
});

/**
 * Two plans whose processes reported different corners of the same usage shape:
 * one stated a cost, the other stated cache reads, and neither stated anything
 * about cache creation.
 */
const setupPlansWithPartialUsage = () => ({
	reports: [
		buildActivityTree({
			plan: 'my-ticket/plan-1',
			marks: [
				levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
				harnessProcess({
					levelId: 'run-1',
					startedAt: '2026-09-17T00:00:00.000Z',
					endedAt: '2026-09-17T00:00:03.000Z',
					usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.5 },
				}),
				levelEnd({ id: 'run-1', at: '2026-09-17T00:00:04.000Z' }),
			],
		}),
		buildActivityTree({
			plan: 'my-ticket/plan-2',
			marks: [
				levelStart({ id: 'run-2', at: '2026-09-17T00:00:10.000Z' }),
				harnessProcess({
					levelId: 'run-2',
					startedAt: '2026-09-17T00:00:10.000Z',
					endedAt: '2026-09-17T00:00:14.000Z',
					usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 7 },
				}),
				levelEnd({ id: 'run-2', at: '2026-09-17T00:00:15.000Z' }),
			],
		}),
	],
});

/**
 * Two plans of one ticket, the first finished and the second still running: its
 * command run was opened and never closed, which is what a record looks like
 * while a plan command is mid-flight.
 */
const setupTicketStillRunning = () => ({
	reports: [
		buildActivityTree({
			plan: 'my-ticket/plan-1',
			marks: [
				levelStart({ id: 'run-1', at: '2026-09-17T00:00:00.000Z' }),
				harnessProcess({ levelId: 'run-1', startedAt: '2026-09-17T00:00:00.000Z', endedAt: '2026-09-17T00:00:03.000Z' }),
				levelEnd({ id: 'run-1', at: '2026-09-17T00:00:04.000Z' }),
			],
		}),
		buildActivityTree({
			plan: 'my-ticket/plan-2',
			marks: [
				levelStart({ id: 'run-2', at: '2026-09-17T00:00:10.000Z' }),
				harnessProcess({ levelId: 'run-2', startedAt: '2026-09-17T00:00:10.000Z', endedAt: '2026-09-17T00:00:12.000Z' }),
			],
		}),
	],
});

/** A ticket folder whose every plan folder held no readable activity record. */
const setupTicketWithNoReports = () => ({ reports: [] as ActivityReport[] });

describe('totalActivityReports', () => {
	test('totalActivityReports: peak concurrency and busy time are computed across the ticket, never added from the plans', () => {
		const { reports } = setupOverlappingPlans();

		const totals = totalActivityReports({ reports });

		// Each plan's own peak is two, so three is the cross-plan overlap rather
		// than the two peaks added (four) or the larger of them (two); and the
		// two six-second busy stretches overlap into nine, never twelve.
		expect(totals).toEqual(
			expect.objectContaining({
				peakProcesses: 3,
				busyMs: 9_000,
				wallMs: 12_000,
				idleMs: 3_000,
			}),
		);
	});

	test('totalActivityReports: the addable figures add and an unreported field stays absent', () => {
		const { reports } = setupPlansWithPartialUsage();

		const totals = totalActivityReports({ reports });

		// toEqual ignores an absent key and an explicit undefined alike, and fails
		// on a 0 — which is what keeps a cache-creation count nobody reported from
		// reading as a ticket that created no cache.
		expect(totals).toEqual(
			expect.objectContaining({
				agentMs: 7_000,
				processCount: 2,
				usage: { inputTokens: 150, outputTokens: 25, cacheReadTokens: 7, costUsd: 0.5 },
			}),
		);
	});

	test('totalActivityReports: one plan still running leaves the ticket unfinished while its agent time still adds', () => {
		const { reports } = setupTicketStillRunning();

		const totals = totalActivityReports({ reports });

		// A ticket is over only when every plan of it is. Borrowing the finished
		// plan's end time would report the ticket as done — and charge the hours
		// since to idle — while an agent was still running in the other one.
		expect(totals.wallMs).toBeUndefined();
		expect(totals.idleMs).toBeUndefined();
		expect(totals).toEqual(expect.objectContaining({ agentMs: 5_000, busyMs: 5_000, processCount: 2, peakProcesses: 1 }));
	});

	test('totalActivityReports: a ticket with no report at all totals nothing rather than failing', () => {
		const { reports } = setupTicketWithNoReports();

		const totals = totalActivityReports({ reports });

		// Every plan folder of a ticket can predate the activity record, and the
		// ticket row is still drawn — so the empty fold has to answer, with no
		// wall time and no idle time to claim.
		expect(totals).toStrictEqual({ wallMs: undefined, agentMs: 0, busyMs: 0, idleMs: undefined, peakProcesses: 0, processCount: 0, usage: {} });
	});
});
