interface Params {
	records: Array<{ amount: number }>;
}

// The same helper, retyped — the moment a second file needed it, it had earned
// an export and a file of its own.
const sumTotals = ({ records }: { records: Array<{ amount: number }> }) => records.reduce((total, record) => total + record.amount, 0);

export const buildInvoiceTotals = ({ records }: Params): { total: number } => ({ total: sumTotals({ records }) });
