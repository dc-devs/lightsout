import { Invoice } from './Invoice';

interface Params {
	invoice: Invoice;
}

export const getChargeLabel = ({ invoice }: Params): string => invoice.label;
