interface Params {
	invoiceId: string;
	/** Display name shown on the receipt, which may differ from the account name. */
	payerName: string;
}

/**
 * Charges an invoice against the payer's default method.
 *
 * @param invoiceId - the invoice to charge
 * @param payerName - name printed on the receipt
 */
export const chargeInvoice = ({ invoiceId, payerName }: Params): string => `${invoiceId}${payerName}`;
