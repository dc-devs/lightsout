interface Params {
	records: Array<{ amount: number }>;
}

// The helper a second file also needs, still unexported here — so the second
// file copied it instead of importing it.
const sumTotals = ({ records }: { records: Array<{ amount: number }> }) => records.reduce((total, record) => total + record.amount, 0);

export const buildReportSummary = ({ records }: Params): { total: number } => ({ total: sumTotals({ records }) });
