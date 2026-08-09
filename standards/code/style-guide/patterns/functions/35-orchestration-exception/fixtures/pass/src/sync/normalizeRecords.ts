interface Params {
	records: Array<{ id: string; amount: number }>;
}

export const normalizeRecords = ({ records }: Params): Array<{ id: string; amount: number }> =>
	records.map((record) => ({ id: record.id.trim().toLowerCase(), amount: Math.round(record.amount * 100) / 100 }));
