interface Issue {
	id: string;
	state: string;
	amount: number;
}

export const buildIssueSummary = ({ issues }: { issues: Issue[] }): Record<string, number> => {
	const totals: Record<string, number> = {};

	for (const issue of issues) {
		totals[issue.state] = (totals[issue.state] ?? 0) + issue.amount;
	}

	return totals;
};
