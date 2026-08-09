export const sumCharges = ({ charges }: { charges: number[] }): number => {
	let total = 0;

	for (let index = 0; index < charges.length; index += 1) {
		total += charges[index] ?? 0;
	}

	return total;
};
