import type { Issue } from '@linear/sdk';
import { collectNodes } from '#src/ticketTracker/linear/common/utils/collectNodes.ts';

interface Params {
	issue: Issue;
}

/**
 * Every label name on one issue, paged to exhaustion.
 *
 * A truncated label list would make a ticket look like it carries one route
 * label when it carries two, which is exactly the case the queue's skip policy
 * exists to catch — so the walk is never allowed to stop at the first page.
 */
export const readLabelNames = async ({ issue }: Params): Promise<string[]> => {
	const labels = await collectNodes({ connection: await issue.labels() });

	return labels.map((label) => label.name);
};
