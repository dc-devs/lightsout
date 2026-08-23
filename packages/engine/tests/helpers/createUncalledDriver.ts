import type { Driver } from '#src/drivers/index.ts';

interface Params {
	/** What the throw says when the spawn a test asserts does NOT happen happens anyway. */
	reason: string;
}

/** A driver that must never be invoked — the spawn a test asserts does NOT happen, made loud rather than silent. */
export const createUncalledDriver = ({ reason }: Params): Driver => ({
	name: 'stub',
	invoke: async () => {
		throw new Error(reason);
	},
});
