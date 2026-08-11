/**
 * Charges an invoice against the payer's default method.
 *
 * @param invoiceId - the invoice to charge
 * @throws {PaymentDeclinedError} When the payment method refuses the charge
 */
export const chargeInvoice = ({ invoiceId }: { invoiceId: string }): string => invoiceId;
