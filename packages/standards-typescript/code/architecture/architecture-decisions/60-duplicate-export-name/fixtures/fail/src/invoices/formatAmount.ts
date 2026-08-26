// One name, two homes: either one concept implemented twice, or a helper that
// has earned promotion to the lowest common ancestor `common/`.
export const formatAmount = ({ cents }: { cents: number }): string => `${(cents / 100).toFixed(2)} USD`;
