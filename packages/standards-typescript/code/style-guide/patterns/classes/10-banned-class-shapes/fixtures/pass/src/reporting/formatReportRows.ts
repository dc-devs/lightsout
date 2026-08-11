interface Params {
	rows: Array<{ label: string; amount: number }>;
}

// The one-method class rewritten as what it always was.
export const formatReportRows = ({ rows }: Params): string => rows.map((row) => `${row.label}: ${row.amount}`).join('\n');
