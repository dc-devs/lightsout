import type { Invoice } from './Invoice';
import { formatAmount } from './formatAmount';

interface Params {
	invoice: Invoice;
	amount: number;
}

export const getChargeLabel = ({ invoice, amount }: Params): string => `${invoice.label} ${formatAmount({ amount })}`;
