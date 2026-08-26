interface Issue {
	id: string;
	title: string;
	state: string;
	assignee: string | null;
}

interface Props {
	issues: Issue[];
}

// Past the threshold with inline logic rather than JSX composition: the header,
// the filters and the row rendering are three sub-components waiting to be cut
// out of it.
export const IssuePanel = ({ issues }: Props) => {
	const open = issues.filter((issue) => issue.state === 'open');
	const closed = issues.filter((issue) => issue.state === 'closed');
	const unassigned = open.filter((issue) => issue.assignee === null);
	const byAssignee: Record<string, Issue[]> = {};

	for (const issue of open) {
		const key = issue.assignee ?? 'unassigned';

		byAssignee[key] = [...(byAssignee[key] ?? []), issue];
	}

	return (
		<section>
			<header>
				<h2>Issues</h2>
				<p>
					{open.length} open, {closed.length} closed, {unassigned.length} unassigned
				</p>
			</header>
			{Object.entries(byAssignee).map(([assignee, assigned]) => (
				<div key={assignee}>
					<h3>{assignee}</h3>
					<ul>
						{assigned.map((issue) => (
							<li key={issue.id}>
								{issue.title} — {issue.state}
							</li>
						))}
					</ul>
				</div>
			))}
		</section>
	);
};
