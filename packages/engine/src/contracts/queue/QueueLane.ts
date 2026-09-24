/**
 * The seven columns of the queue's board, one of which each ticket is in.
 *
 * A ticket is in exactly one lane at a time, so the board never counts one
 * twice. The key order is the board's column order, left to right: whatever
 * draws the board reads its columns from here, so reordering the keys moves
 * the columns. The order is the order the work moves in: Parked and Blocked,
 * where a ticket is held, come first, and Shipped, where work ends, is last.
 */
export const QueueLane = {
	Parked: 'parked',
	Blocked: 'blocked',
	BuildQueue: 'build-queue',
	Building: 'building',
	ShipQueue: 'ship-queue',
	ShippingNow: 'shipping-now',
	Shipped: 'shipped',
} as const;

export type QueueLane = (typeof QueueLane)[keyof typeof QueueLane];
