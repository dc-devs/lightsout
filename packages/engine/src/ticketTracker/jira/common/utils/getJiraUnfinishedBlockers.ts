import type { JiraIssue } from '#src/ticketTracker/jira/common/types/JiraIssue.ts';
import { isFinishedJiraStatus } from '#src/ticketTracker/jira/common/utils/isFinishedJiraStatus.ts';

interface Params {
	issue: JiraIssue;
}

/**
 * The keys of every blocking ticket this issue is still waiting on.
 *
 * Jira stores "A blocks B" once, as a link between the two; from B's side it is
 * the inward end, so the blockers of an issue are the `inwardIssue` of its links
 * whose inward description is 'is blocked by' — the default wording of Jira's
 * own 'Blocks' link type, which a site is free to rename.
 *
 * A blocker whose status category cannot be read is kept rather than dropped:
 * waiting one extra run is recoverable, shipping a dependent ahead of its
 * blocker is not.
 */
export const getJiraUnfinishedBlockers = ({ issue }: Params): string[] =>
	(issue.fields.issuelinks ?? []).flatMap((link) => {
		const linked = link.type?.inward === 'is blocked by' ? link.inwardIssue : undefined;
		const key = linked?.key;

		return key === undefined || isFinishedJiraStatus({ categoryKey: linked?.fields?.status?.statusCategory?.key }) ? [] : [key];
	});
