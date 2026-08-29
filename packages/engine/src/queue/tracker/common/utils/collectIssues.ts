import type { Issue, IssueConnection } from '@linear/sdk';

interface Params {
	/** The first page, as the client answered it. */
	connection: IssueConnection;
}

/**
 * Every issue of a connection, paged to exhaustion.
 *
 * `client.issues` answers one page, and a backlog larger than a page read as a
 * smaller queue than exists — a silently truncated backlog is the one wrong
 * answer a queue must never give.
 */
export const collectIssues = async ({ connection }: Params): Promise<Issue[]> => {
	let page = connection;

	while (page.pageInfo.hasNextPage) {
		page = await page.fetchNext();
	}

	return page.nodes;
};
