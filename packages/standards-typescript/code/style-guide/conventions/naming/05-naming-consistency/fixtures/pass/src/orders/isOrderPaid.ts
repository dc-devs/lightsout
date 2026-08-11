// The domain already prefixes its booleans with `is`, so this one does too.
export const isOrderPaid = ({ paidAt }: { paidAt: string | null }): boolean => paidAt !== null;
