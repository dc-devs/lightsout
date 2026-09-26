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

// Every step of the summary inlined into one body — not a linear flow of step
// calls, just a long function, which is the shape the table calls "needs
// splitting".
export const buildReportSummary = ({ rows, rates }: Params): Record<string, number> => {
	const regionTotals: Record<string, number> = {};
	const regionRefunds: Record<string, number> = {};
	const regionCounts: Record<string, number> = {};

	for (const row of rows) {
		const converted = row.amount * (rates[row.currency] ?? 1);

		if (row.refunded) {
			regionRefunds[row.region] = (regionRefunds[row.region] ?? 0) + converted;
		} else {
			regionTotals[row.region] = (regionTotals[row.region] ?? 0) + converted;
		}

		regionCounts[row.region] = (regionCounts[row.region] ?? 0) + 1;
	}

	const productTotals: Record<string, number> = {};
	const productRefunds: Record<string, number> = {};
	const productCounts: Record<string, number> = {};

	for (const row of rows) {
		const converted = row.amount * (rates[row.currency] ?? 1);

		if (row.refunded) {
			productRefunds[row.product] = (productRefunds[row.product] ?? 0) + converted;
		} else {
			productTotals[row.product] = (productTotals[row.product] ?? 0) + converted;
		}

		productCounts[row.product] = (productCounts[row.product] ?? 0) + 1;
	}

	const currencyTotals: Record<string, number> = {};
	const currencyRefunds: Record<string, number> = {};
	const currencyCounts: Record<string, number> = {};

	for (const row of rows) {
		const converted = row.amount * (rates[row.currency] ?? 1);

		if (row.refunded) {
			currencyRefunds[row.currency] = (currencyRefunds[row.currency] ?? 0) + converted;
		} else {
			currencyTotals[row.currency] = (currencyTotals[row.currency] ?? 0) + converted;
		}

		currencyCounts[row.currency] = (currencyCounts[row.currency] ?? 0) + 1;
	}

	const summary: Record<string, number> = {};

	for (const [region, total] of Object.entries(regionTotals)) {
		summary[`region.${region}.total`] = total;
		summary[`region.${region}.refunded`] = regionRefunds[region] ?? 0;
		summary[`region.${region}.count`] = regionCounts[region] ?? 0;
		summary[`region.${region}.average`] = total / (regionCounts[region] ?? 1);
	}

	for (const [product, total] of Object.entries(productTotals)) {
		summary[`product.${product}.total`] = total;
		summary[`product.${product}.refunded`] = productRefunds[product] ?? 0;
		summary[`product.${product}.count`] = productCounts[product] ?? 0;
		summary[`product.${product}.average`] = total / (productCounts[product] ?? 1);
	}

	for (const [currency, total] of Object.entries(currencyTotals)) {
		summary[`currency.${currency}.total`] = total;
		summary[`currency.${currency}.refunded`] = currencyRefunds[currency] ?? 0;
		summary[`currency.${currency}.count`] = currencyCounts[currency] ?? 0;
		summary[`currency.${currency}.average`] = total / (currencyCounts[currency] ?? 1);
	}

	summary['rows.counted'] = rows.length;
	summary['rows.refunded'] = rows.filter((row) => row.refunded).length;
	summary['rows.settled'] = rows.filter((row) => !row.refunded).length;
	summary['regions.counted'] = Object.keys(regionTotals).length;
	summary['products.counted'] = Object.keys(productTotals).length;
	summary['currencies.counted'] = Object.keys(currencyTotals).length;

	for (const [region, count] of Object.entries(regionCounts)) {
		summary[`region.${region}.share`] = count / rows.length;
	}

	for (const [product, count] of Object.entries(productCounts)) {
		summary[`product.${product}.share`] = count / rows.length;
	}

	for (const [currency, count] of Object.entries(currencyCounts)) {
		summary[`currency.${currency}.share`] = count / rows.length;
	}

	return summary;
};
