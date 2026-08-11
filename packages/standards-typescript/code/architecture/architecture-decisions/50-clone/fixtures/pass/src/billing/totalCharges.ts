interface Params {
	charges: Array<{ amount: number; multiplier: number }>;
}

export const totalCharges = ({ charges }: Params): number => {
	return charges.reduce((total, charge) => total + charge.amount * charge.multiplier, 0);
};
