// A single-file primitive, so promotion lands it in the ancestor level's
// `common/utils/` rather than making a module of it.
export const formatMoney = ({ cents }: { cents: number }): string => `$${(cents / 100).toFixed(2)}`;
