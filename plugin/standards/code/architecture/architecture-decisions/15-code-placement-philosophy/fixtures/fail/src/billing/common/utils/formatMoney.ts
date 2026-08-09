export const formatMoney = ({ cents }: { cents: number }): string => `$${(cents / 100).toFixed(2)}`;
