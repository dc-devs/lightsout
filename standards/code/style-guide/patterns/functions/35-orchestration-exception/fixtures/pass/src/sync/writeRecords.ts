interface Params {
	records: Array<{ id: string; amount: number }>;
}

export const writeRecords = ({ records }: Params): string[] => records.filter((record) => record.amount > 0).map((record) => `${record.id}:${record.amount}`);
