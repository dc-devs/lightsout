interface Params {
	records: Array<{ id: string; amount: number }>;
}

// Called orchestration, but the steps are inline: loops and transformations in
// the body, not a linear sequence of step calls.
export const startSync = ({ records }: Params): string[] => {
	const written: string[] = [];

	for (const record of records) {
		const normalized = record.id.trim().toLowerCase();

		if (normalized.length > 0 && record.amount > 0) {
			const rounded = Math.round(record.amount * 100) / 100;

			written.push(`${normalized}:${rounded}`);
		}
	}

	return written;
};
