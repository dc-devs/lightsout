interface Issue {
	id: string;
	state: string;
	amount: number;
}

// The hook computes instead of composing: the totals, the averages and the
// ordering are pure logic that belongs in utilities the hook calls.
export const useIssueSummary = ({ issues }: { issues: Issue[] }) => {
	const totals: Record<string, number> = {};
	const counts: Record<string, number> = {};

	for (const issue of issues) {
		totals[issue.state] = (totals[issue.state] ?? 0) + issue.amount;
		counts[issue.state] = (counts[issue.state] ?? 0) + 1;
	}

	const averages: Record<string, number> = {};

	for (const [state, total] of Object.entries(totals)) {
		averages[state] = total / (counts[state] ?? 1);
	}

	const ordered = Object.entries(averages).sort(([, left], [, right]) => right - left);

	return { totals, counts, averages, ordered };
};
