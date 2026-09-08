import { describe, expect, jest, test } from '@jest/globals';
import { settleMergedSelection } from '#src/queue/drainLanes/common/utils/settleMergedSelection.ts';
import type { reconcileMergedTickets } from '#src/queue/ticketSelection/index.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

const mockReconcile = jest.fn<typeof reconcileMergedTickets>();

jest.mock('#src/queue/ticketSelection/index.ts', () => ({
	reconcileMergedTickets: (params: Parameters<typeof reconcileMergedTickets>[0]) => mockReconcile(params),
}));

describe('settleMergedSelection', () => {
	test('reconciles inside the checkout serializer and appends merged tickets to the existing skips', async () => {
		const { context } = setupDrainLaneState();
		const ticket = queueTicketFixture();
		const kept = queueTicketFixture({ number: 71 });
		const skipped = { identifier: 'LO-72', reason: 'withdrawn' };
		const merged = { identifier: 'LO-70', reason: 'already merged', settled: true };
		const blocked = { identifier: 'LO-73', reason: 'blocked' };
		let insideSerializer = false;
		let reconciledInside = false;

		mockReconcile.mockImplementation(async () => {
			reconciledInside = insideSerializer;
			return { kept: [kept], leftBehind: [merged] };
		});
		context.serializeMainCheckout = async ({ task }) => {
			insideSerializer = true;
			try {
				return await task();
			} finally {
				insideSerializer = false;
			}
		};

		const selection = { runnable: [ticket, kept], blocked: [blocked], skipped: [skipped] };
		const result = await settleMergedSelection({ ...context, selection });

		expect(reconciledInside).toBe(true);
		expect(mockReconcile).toHaveBeenCalledWith(expect.objectContaining({ tickets: [ticket, kept], env: context.env, settings: context.settings }));
		expect(result).toEqual({ runnable: [kept], blocked: [blocked], skipped: [skipped, merged] });
		expect(selection.skipped).toEqual([skipped]);
	});
});
