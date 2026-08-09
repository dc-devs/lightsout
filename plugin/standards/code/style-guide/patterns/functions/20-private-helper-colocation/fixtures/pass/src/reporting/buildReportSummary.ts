interface Params {
	records: Array<{ amount: number }>;
}

// Called only from this file, so it stays a compiler-enforced internal and is
// covered through the export's own tests.
const sumTotals = ({ records }: { records: Array<{ amount: number }> }) => records.reduce((total, record) => total + record.amount, 0);

export const buildReportSummary = ({ records }: Params): { total: number } => ({ total: sumTotals({ records }) });
