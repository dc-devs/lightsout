import { describe, expect, jest, test } from '@jest/globals';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import { settleMergedSelection } from '#src/queue/drainLanes/common/utils/settleMergedSelection.ts';
import type { reconcileMergedTickets } from '#src/queue/ticketSelection/reconcileMergedTickets.ts';
import { namedWorkOrderFixture } from '#tests/helpers/namedWorkOrderFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

const mockReconcile = jest.fn<typeof reconcileMergedTickets>();

jest.mock('#src/queue/ticketSelection/index.ts', () => ({
	reconcileMergedTickets: (params: Parameters<typeof reconcileMergedTickets>[0]) => mockReconcile(params),
}));

describe('settleMergedSelection', () => {
	test('reconciles inside the checkout serializer and appends merged tickets to the existing skips', async () => {
		const { context } = setupDrainLaneState();
		const merged: NamedWorkOrder = namedWorkOrderFixture({ ticket: queueTicketFixture() });
		const kept: NamedWorkOrder = namedWorkOrderFixture({ ticket: queueTicketFixture({ number: 71 }) });
		const skipped = { identifier: 'LO-72', reason: 'withdrawn' };
		const mergedSkip = { identifier: 'LO-70', reason: 'already merged', settled: true };
		let insideSerializer = false;
		let reconciledInside = false;

		mockReconcile.mockImplementation(async () => {
			reconciledInside = insideSerializer;
			return { kept: [kept], leftBehind: [mergedSkip] };
		});
		context.serializeMainCheckout = async ({ task }) => {
			insideSerializer = true;
			try {
				return await task();
			} finally {
				insideSerializer = false;
			}
		};

		const held = [skipped];
		const result = await settleMergedSelection({ ...context, workOrders: [merged, kept], skipped: held });

		expect(reconciledInside).toBe(true);
		expect(mockReconcile).toHaveBeenCalledWith(expect.objectContaining({ tickets: [merged, kept], env: context.env }));
		expect(result).toEqual({ workOrders: [kept], skipped: [skipped, mergedSkip] });
		expect(held).toEqual([skipped]);
	});
});
