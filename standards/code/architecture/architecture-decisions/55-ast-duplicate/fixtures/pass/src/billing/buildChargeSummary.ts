interface Params {
	id: number;
	totals: Record<string, number>;
}

export const buildChargeSummary = ({ id, totals }: Params): Record<string, number> => {
	const first = totals.a + totals.b + totals.c + totals.d;
	const second = first + totals.e + totals.f + totals.g + totals.h;
	const third = second + totals.i + totals.j + totals.k + totals.l;

	return { id, first, second, third };
};
