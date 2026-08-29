import { describe, expect, jest, test } from '@jest/globals';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketRunOutcome } from '#src/queue/common/types/TicketRunOutcome.ts';
import { settleParkedLabels } from '#src/queue/settleParkedLabels.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';

// Mocked Imports
// -------------------------
// The label write is covered by `setParkedLabel`'s own tests. What this file
// owns is which outcome is labelled which way, and that a failed write costs
// the run nothing.
type LabelParams = { settings: QueueSettings; ticketId: string; parked: boolean };

const mockSetParkedLabel = jest.fn<(params: LabelParams) => Promise<QueueFailure | undefined>>();

jest.mock('#src/queue/tracker/index.ts', () => ({ setParkedLabel: (params: LabelParams) => mockSetParkedLabel(params) }));
// -------------------------

const outcomeOf = ({ number, ready }: { number: number; ready: boolean }): TicketRunOutcome => ({
	ticket: {
		id: `id-${number}`,
		identifier: `LO-${number}`,
		title: `Ticket ${number}`,
		description: '',
		priority: 2,
		createdAt: '2026-01-01T00:00:00.000Z',
		route: QueueRoute.Direct,
	},
	branch: `lo-${number}-ticket`,
	worktreePath: `/tmp/worktrees/lo-${number}-ticket`,
	ready,
});

describe('settleParkedLabels', () => {
	test('labels every outcome that did not ship and clears the label from every one that did', async () => {
		mockSetParkedLabel.mockResolvedValue(undefined);

		await settleParkedLabels({
			settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }),
			outcomes: [outcomeOf({ number: 70, ready: true }), outcomeOf({ number: 71, ready: false })],
		});

		expect(mockSetParkedLabel.mock.calls.map(([params]) => ({ ticketId: params.ticketId, parked: params.parked }))).toStrictEqual([
			{ ticketId: 'id-70', parked: false },
			{ ticketId: 'id-71', parked: true },
		]);
	});

	test('writes nothing at all when the repo opted out, so a tracker nobody configured is never touched', async () => {
		await settleParkedLabels({ settings: queueSettingsFixture(), outcomes: [outcomeOf({ number: 70, ready: false })] });

		expect(mockSetParkedLabel).not.toHaveBeenCalled();
	});

	test('reports a failed write as progress and lets the drain finish — the tracker is a courtesy, never a precondition', async () => {
		const progress: string[] = [];

		mockSetParkedLabel.mockResolvedValue({ error: 'the tracker did not answer' });

		await expect(
			settleParkedLabels({
				settings: queueSettingsFixture({ parkedLabel: 'queue-parked' }),
				outcomes: [outcomeOf({ number: 70, ready: false })],
				onProgress: (message) => progress.push(message),
			}),
		).resolves.toBeUndefined();

		expect(progress).toStrictEqual(["LO-70 · the 'queue-parked' label could not be written: the tracker did not answer"]);
	});
});
