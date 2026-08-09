interface Props {
	issues: Array<{ id: string; title: string }>;
}

// Measured from the signature to the closing brace, which is the whole of what
// this component is.
export const IssueList = ({ issues }: Props) => (
	<ul>
		{issues.map((issue) => (
			<li key={issue.id}>{issue.title}</li>
		))}
	</ul>
);
