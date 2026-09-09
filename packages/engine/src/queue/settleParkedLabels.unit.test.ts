import { describe, expect, jest, test } from '@jest/globals';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { settleParkedLabels } from '#src/queue/settleParkedLabels.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
import { trackerSettingsFixture } from '#tests/helpers/trackerSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The label write is covered by `setTicketLabel`'s own tests. What this file
// owns is which outcome is labelled which way, and that a failed write costs
// the run nothing.
type LabelParams = { settings: TrackerSettings; ticketId: string; label: string | undefined; present: boolean };

const mockSetTicketLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/ticketTracker/index.ts', () => ({ setTicketLabel: (params: LabelParams) => mockSetTicketLabel(params) }));
// -------------------------

const outcomeOf = ({ number, ready }: { number: number; ready: boolean }): TicketRunOutcome => ({
	ticket: {
		id: `id-${number}`,
		identifier: `LO-${number}`,
		title: `Ticket ${number}`,
		description: '',
		priority: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		labels: [],
		planningStatus: PlanningStatus.NotNeeded,
		worker: QueueWorker.Direct,
		status: 'Ready to implement',
		finished: false,
		unfinishedBlockers: [],
	},
	branch: `lo-${number}-ticket`,
	worktreePath: `/tmp/worktrees/lo-${number}-ticket`,
	ready,
});

describe('settleParkedLabels', () => {
	test('labels every outcome that did not ship and clears the label from every one that did', async () => {
		mockSetTicketLabel.mockResolvedValue(undefined);

		await settleParkedLabels({
			settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }),
			trackerSettings: trackerSettingsFixture(),
			outcomes: [outcomeOf({ number: 70, ready: true }), outcomeOf({ number: 71, ready: false })],
		});

		expect(mockSetTicketLabel.mock.calls.map(([params]) => ({ ticketId: params.ticketId, label: params.label, present: params.present }))).toStrictEqual([
			{ ticketId: 'id-70', label: 'queue-parked', present: false },
			{ ticketId: 'id-71', label: 'queue-parked', present: true },
		]);
	});

	test('never writes the gate-blocked label', async () => {
		mockSetTicketLabel.mockResolvedValue(undefined);

		await settleParkedLabels({
			settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }),
			trackerSettings: trackerSettingsFixture(),
			outcomes: [outcomeOf({ number: 80, ready: true }), outcomeOf({ number: 81, ready: false })],
		});

		expect(mockSetTicketLabel.mock.calls.map(([params]) => params.label)).toStrictEqual(['queue-parked', 'queue-parked']);
	});

	test('writes nothing at all when the repo opted out, so a tracker nobody configured is never touched', async () => {
		await settleParkedLabels({
			settings: queueSettingsFixture(),
			trackerSettings: trackerSettingsFixture(),
			outcomes: [outcomeOf({ number: 70, ready: false })],
		});

		expect(mockSetTicketLabel).not.toHaveBeenCalled();
	});

	test('reports a failed write as progress and lets the drain finish — the tracker is a courtesy, never a precondition', async () => {
		const progress: string[] = [];

		mockSetTicketLabel.mockResolvedValue({ error: 'the tracker did not answer' });

		await expect(
			settleParkedLabels({
				settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }),
				trackerSettings: trackerSettingsFixture(),
				outcomes: [outcomeOf({ number: 70, ready: false })],
				onProgress: (message) => progress.push(message),
			}),
		).resolves.toBeUndefined();

		expect(progress).toStrictEqual(["LO-70 · the 'queue-parked' label could not be written: the tracker did not answer"]);
	});
});
