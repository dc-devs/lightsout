import type { JiraIssue } from '#src/queue/tracker/jira/common/types/JiraIssue.ts';

interface Params {
	issue: JiraIssue;
}

export const getJiraUnfinishedBlockers = ({ issue }: Params): string[] =>
	(issue.fields.issuelinks ?? []).flatMap((link) => {
		const linked = link.type?.inward === 'is blocked by' ? link.inwardIssue : undefined;
		const key = linked?.key;

		return key === undefined || linked?.fields?.status?.statusCategory?.key === 'done' ? [] : [key];
	});
