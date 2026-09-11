import type { ShippingProgress } from '#src/contracts/index.ts';

/**
 * What reading a branch's shipping record found. A missing record and an
 * unreadable one are told apart, because the shipping block draws a missing
 * record as every step not reached and names an unreadable one instead.
 */
export interface ShippingProgressReading {
	/** Where the record is filed for the branch, whether or not a file is there. */
	path: string;
	/** True when a file is at `path`. */
	exists: boolean;
	/** The parsed record; undefined when the file is absent, unreadable or off-contract. */
	progress: ShippingProgress | undefined;
}
