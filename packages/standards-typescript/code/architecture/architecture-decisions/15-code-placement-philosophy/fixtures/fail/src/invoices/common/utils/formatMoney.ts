// Two features reached for the same helper and neither searched `common/`
// first, so the reuse is proven but the code never moved up to the lowest
// common ancestor.
export const formatMoney = ({ cents }: { cents: number }): string => `$${(cents / 100).toFixed(2)}`;
