import { formatAmount } from '../common/utils/formatAmount';

// One home for the shared name, and every other file in the repo carries a name
// of its own.
export const getInvoiceLabel = ({ cents, reference }: { cents: number; reference: string }): string =>
	`${reference} — ${formatAmount({ cents })}`;
