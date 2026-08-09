export const sumCharges = ({ c }: { c: number[] }): number => {
	let t = 0;

	for (const v of c) {
		t += v;
	}

	return t;
};
