interface Row {
	region: string;
	product: string;
	currency: string;
	amount: number;
	refunded: boolean;
}

interface Params {
	rows: Row[];
	rates: Record<string, number>;
}

// One grouping helper the export reuses three times — the same report, with the
// body under the cap because the repeated work was named once.
const sumBy = ({ rows, rates, key }: { rows: Row[]; rates: Record<string, number>; key: keyof Row }) => {
	const totals: Record<string, number> = {};

	for (const row of rows) {
		const group = String(row[key]);

		totals[group] = (totals[group] ?? 0) + row.amount * (rates[row.currency] ?? 1);
	}

	return totals;
};

export const buildReportSummary = ({ rows, rates }: Params): Record<string, number> => {
	const summary: Record<string, number> = {};

	for (const key of ['region', 'product', 'currency'] as const) {
		for (const [group, total] of Object.entries(sumBy({ rows, rates, key }))) {
			summary[`${key}.${group}.total`] = total;
		}
	}

	summary['rows.counted'] = rows.length;

	return summary;
};
