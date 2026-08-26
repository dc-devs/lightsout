interface Issue {
	id: string;
	title: string;
	state: string;
	assignee: string | null;
}

export const groupByAssignee = ({ issues }: { issues: Issue[] }): Record<string, Issue[]> => {
	const grouped: Record<string, Issue[]> = {};

	for (const issue of issues) {
		const key = issue.assignee ?? 'unassigned';

		grouped[key] = [...(grouped[key] ?? []), issue];
	}

	return grouped;
};
