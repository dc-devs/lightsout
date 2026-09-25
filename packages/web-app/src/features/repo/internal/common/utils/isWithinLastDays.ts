interface Params {
	/** ISO timestamp, as every manifest and ledger line records one. */
	at: string;
	days: number;
}

/**
 * Whether a recorded moment falls inside a trailing window ending now.
 *
 * Trailing rather than calendar: "this week" would mean something different on
 * a Monday morning than on a Sunday night, and different again in another
 * timezone, while "the last seven days" means one thing everywhere. A timestamp
 * the clock cannot read is outside every window rather than inside all of them
 * — a tile counting unreadable dates would be worse than one that skipped them.
 */
export const isWithinLastDays = ({ at, days }: Params): boolean => {
	const hoursPerDay = 24;
	const parsed = new Date(at).getTime();

	return !Number.isNaN(parsed) && Date.now() - parsed <= days * hoursPerDay * 60 * 60 * 1000;
};
