import type { ReactNode } from 'react';

interface Issue {
	id: string;
	title: string;
}

interface Props {
	issues: Issue[];
	empty: ReactNode;
}

// Called oversized on a whole-file count: the imports, the two interfaces and
// this comment are not part of the component's span.
export const IssueList = ({ issues, empty }: Props) => (
	<ul>{issues.length === 0 ? empty : issues.map((issue) => <li key={issue.id}>{issue.title}</li>)}</ul>
);
