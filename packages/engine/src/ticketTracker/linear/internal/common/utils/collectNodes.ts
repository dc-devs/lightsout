import type { Connection } from '@linear/sdk';

interface Params<Node> {
	/** The first page, as the client answered it. */
	connection: Connection<Node>;
}

/**
 * Every node of a Linear connection, paged to exhaustion.
 *
 * A connection answers one page, and a backlog larger than a page read as a
 * smaller queue than exists — a silently truncated backlog is the one wrong
 * answer a queue must never give. The same is true of an issue's blocking
 * relations: a truncated relation list under-reports blockers, which ships a
 * dependent ahead of its blocker.
 */
export const collectNodes = async <Node>({ connection }: Params<Node>): Promise<Node[]> => {
	let page = connection;

	while (page.pageInfo.hasNextPage) {
		page = await page.fetchNext();
	}

	return page.nodes;
};
