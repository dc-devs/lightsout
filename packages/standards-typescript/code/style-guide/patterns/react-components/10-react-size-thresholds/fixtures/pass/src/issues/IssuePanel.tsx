import { IssueGroup } from './IssueGroup';
import { groupByAssignee } from './groupByAssignee';

interface Props {
	issues: Array<{ id: string; title: string; state: string; assignee: string | null }>;
}

// JSX composition with the grouping pulled out to a utility — short, and short
// for the reason the table cares about.
export const IssuePanel = ({ issues }: Props) => (
	<section>
		{Object.entries(groupByAssignee({ issues })).map(([assignee, assigned]) => (
			<IssueGroup key={assignee} assignee={assignee} issues={assigned} />
		))}
	</section>
);
