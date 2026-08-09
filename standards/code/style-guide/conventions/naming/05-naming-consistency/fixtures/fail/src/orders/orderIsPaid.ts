// A second boolean convention in a domain whose other predicates read `isX`.
export const orderIsPaid = ({ paidAt }: { paidAt: string | null }): boolean => paidAt !== null;
