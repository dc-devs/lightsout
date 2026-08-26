interface Props {
	assignee: string;
	issues: Array<{ id: string; title: string; state: string }>;
}

export const IssueGroup = ({ assignee, issues }: Props) => (
	<div>
		<h3>{assignee}</h3>
		<ul>
			{issues.map((issue) => (
				<li key={issue.id}>
					{issue.title} — {issue.state}
				</li>
			))}
		</ul>
	</div>
);
