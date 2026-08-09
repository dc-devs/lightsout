interface Params {
	invoices: Array<{ label: string; weight: number }>;
	limit: number;
}

// Same neighbourhood, genuinely different work: a sort and a slice share no
// structure with a chain of sums, so the normalized bodies differ.
export const rankInvoices = ({ invoices, limit }: Params): string[] => {
	const ordered = [...invoices].sort((left, right) => right.weight - left.weight);
	const labels = ordered.map((invoice) => invoice.label);

	return labels.slice(0, limit);
};
