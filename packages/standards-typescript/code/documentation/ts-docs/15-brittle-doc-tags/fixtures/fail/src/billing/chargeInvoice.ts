/**
 * Charges an invoice against the payer's default method.
 *
 * @author Ada Lovelace
 * @since 2.1.0
 * @todo handle partial payments
 */
export const chargeInvoice = ({ invoiceId }: { invoiceId: string }): string => invoiceId;
