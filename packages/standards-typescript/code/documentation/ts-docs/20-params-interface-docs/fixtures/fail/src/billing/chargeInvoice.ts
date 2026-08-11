/**
 * The arguments chargeInvoice takes.
 */
interface Params {
	/** The invoice id. */
	invoiceId: string;
	/** The payer name. */
	payerName: string;
}

export const chargeInvoice = ({ invoiceId, payerName }: Params): string => `${invoiceId}${payerName}`;
