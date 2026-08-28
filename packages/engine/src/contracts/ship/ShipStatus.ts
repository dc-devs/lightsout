/**
 * How a ship attempt ended: the branch reached the default branch, or it did
 * not.
 *
 * Two values only. Every "why not" is `ShipBlockReason`'s job, so a reader
 * asking "did this ship?" never has to know the vocabulary of the ten ways it
 * can stop.
 */
export const ShipStatus = {
	Shipped: 'shipped',
	Blocked: 'blocked',
} as const;

export type ShipStatus = (typeof ShipStatus)[keyof typeof ShipStatus];
