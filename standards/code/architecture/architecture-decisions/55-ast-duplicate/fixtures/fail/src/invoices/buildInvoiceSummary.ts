interface Params {
	reference: number;
	amounts: Record<string, number>;
}

// Every identifier renamed, not one branch changed — the same function wearing
// a different vocabulary, which is what tier 2 sees through and copy-paste
// detection does not.
export const buildInvoiceSummary = ({ reference, amounts }: Params): Record<string, number> => {
	const initial = amounts.a + amounts.b + amounts.c + amounts.d;
	const running = initial + amounts.e + amounts.f + amounts.g + amounts.h;
	const final = running + amounts.i + amounts.j + amounts.k + amounts.l;

	return { reference, initial, running, final };
};
