import { formatDistanceToNow } from 'date-fns';

interface Params {
	/** ISO timestamp, as every manifest and ledger line records one. */
	at: string;
}

/**
 * An ISO timestamp as '3 minutes ago'.
 *
 * A timestamp the clock cannot read is shown as it was recorded rather than as
 * 'Invalid Date' — a run whose manifest holds a bad date is still a row a
 * reader has to be able to scan.
 */
export const formatRelativeTime = ({ at }: Params): string => {
	const parsed = new Date(at);

	return Number.isNaN(parsed.getTime()) ? at : `${formatDistanceToNow(parsed)} ago`;
};
