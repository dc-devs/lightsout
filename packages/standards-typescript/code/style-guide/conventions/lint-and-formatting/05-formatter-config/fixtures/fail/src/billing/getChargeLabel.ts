// Two-space indent and double quotes in a repo whose formatter config says otherwise.
export const getChargeLabel = ({ amount }: { amount: number }): string => {
  return "" + amount;
};
