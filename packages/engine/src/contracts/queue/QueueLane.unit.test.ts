import { describe, expect, test } from '@jest/globals';
import { QueueLane } from '#src/contracts/index.ts';

describe('QueueLane', () => {
	test("lists the seven lanes in the board's column order", () => {
		const lanes = Object.values(QueueLane);

		expect(lanes).toStrictEqual(['build-queue', 'building', 'ship-queue', 'shipping-now', 'shipped', 'parked', 'blocked']);
	});
});
