export const formatAmount = ({ cents }: { cents: number }): string => `$${(cents / 100).toFixed(2)}`;
