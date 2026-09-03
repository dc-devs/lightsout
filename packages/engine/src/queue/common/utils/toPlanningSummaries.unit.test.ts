import { describe, expect, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import { toPlanningSummaries } from '#src/queue/common/utils/toPlanningSummaries.ts';
import type { TrackerTicket } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

const lifecycle = queueSettingsFixture().lifecycle;

const ticketOf = ({ labels, status }: { labels: string[]; status: string }): TrackerTicket => ({
	id: 'id-70',
	identifier: 'LO-70',
	title: 'Drain the backlog',
	description: '',
	priority: 2,
	createdAt: '2026-01-01T00:00:00.000Z',
	labels,
	status,
	unfinishedBlockers: [],
});

describe('toPlanningSummaries', () => {
	test.each([
		{ label: 'planning-ready-auto-plan', status: 'Backlog', worker: QueueWorker.AutoPlan },
		{ label: 'planning-complete', status: 'Ready to implement', worker: QueueWorker.Plan },
		{ label: 'planning-not-needed', status: 'Ready to implement', worker: QueueWorker.Direct },
	])('selects the $worker worker for $label at $status, one of the three pairs the queue takes', ({ label, status, worker }) => {
		const summaries = toPlanningSummaries({ ticket: ticketOf({ labels: [label], status }), lifecycle, resumed: false });

		expect(summaries).toEqual([expect.objectContaining({ planningStatus: label, worker })]);
	});

	test.each([
		{ label: 'planning-needs-brainstorm', status: 'Backlog' },
		{ label: 'planning-needs-plan', status: 'Backlog' },
		{ label: 'planning-not-needed', status: 'Backlog' },
		{ label: 'planning-ready-auto-plan', status: 'Ready to implement' },
		{ label: 'planning-complete', status: 'Backlog' },
	])('selects no worker for $label at $status, so the drain leaves the ticket alone', ({ label, status }) => {
		const summaries = toPlanningSummaries({ ticket: ticketOf({ labels: [label], status }), lifecycle, resumed: false });

		expect(summaries).toEqual([expect.objectContaining({ planningStatus: label, worker: undefined })]);
	});

	test('selects on the planning status alone for a resumed ticket, whose worktree already answered the status half', () => {
		const parked = ticketOf({ labels: ['planning-complete'], status: 'In Progress' });

		expect(toPlanningSummaries({ ticket: parked, lifecycle, resumed: true })).toEqual([expect.objectContaining({ worker: QueueWorker.Plan })]);
		expect(toPlanningSummaries({ ticket: parked, lifecycle, resumed: false })).toEqual([expect.objectContaining({ worker: undefined })]);
	});

	test('answers one summary per planning status label the ticket carries, in the order the statuses are declared', () => {
		const ticket = ticketOf({ labels: ['planning-not-needed', 'planning-complete'], status: 'Ready to implement' });

		expect(toPlanningSummaries({ ticket, lifecycle, resumed: false }).map((summary) => summary.planningStatus)).toStrictEqual([
			PlanningStatus.Complete,
			PlanningStatus.NotNeeded,
		]);
	});

	test('answers nothing for a ticket carrying no configured planning status label, which is the user withdrawing the automation', () => {
		expect(toPlanningSummaries({ ticket: ticketOf({ labels: ['bug'], status: 'Backlog' }), lifecycle, resumed: false })).toStrictEqual([]);
	});
});
