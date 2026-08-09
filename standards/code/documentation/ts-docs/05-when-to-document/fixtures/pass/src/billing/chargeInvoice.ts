/**
 * Charges an invoice against the payer's default method.
 *
 * The 30-day window is a billing-agreement term, not a technical one — an
 * invoice older than that must be re-issued before it can be charged.
 */
export const chargeInvoice = ({ ageInDays }: { ageInDays: number }): boolean => ageInDays <= 30;
