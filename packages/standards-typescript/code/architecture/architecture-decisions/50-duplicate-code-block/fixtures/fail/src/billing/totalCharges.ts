interface Params {
	charges: Array<{ active: boolean; pending: boolean; amount: number; multiplier: number; bonus: number; fee: number; penalty: number }>;
}

export const totalCharges = ({ charges }: Params): number => {
	let total = 0;

	for (const charge of charges) {
		if (charge.active && charge.amount > 0) {
			total += charge.amount * charge.multiplier + charge.bonus;
		} else if (charge.pending) {
			total += charge.amount / 2 - charge.fee;
		} else {
			total -= charge.penalty;
		}
	}

	return total * 100;
};
