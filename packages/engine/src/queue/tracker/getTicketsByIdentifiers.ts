import type { Issue } from '@linear/sdk';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { collectIssues } from '#src/queue/tracker/common/utils/collectIssues.ts';
import { toTicketSummary } from '#src/queue/tracker/common/utils/toTicketSummary.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: QueueSettings;
	/** Human references, e.g. ['LO-70', 'LO-71'] — matched case-insensitively. */
	identifiers: string[];
}

/** The issue numbers an identifier list names, e.g. 'LO-70' → 70. Anything that is not `<key>-<n>` is dropped. */
const readIssueNumbers = ({ identifiers }: { identifiers: string[] }) =>
	identifiers.map((identifier) => Number.parseInt(identifier.split('-').at(-1) ?? '', 10)).filter((issueNumber) => Number.isFinite(issueNumber));

/**
 * One summary per configured route label the issue carries. A ticket whose
 * route labels were all removed yields none — the caller reads that as the user
 * withdrawing the automation.
 */
const toRoutedSummaries = async ({ issue, settings }: { issue: Issue; settings: QueueSettings }) => {
	const labels = await issue.labels();
	const names = new Set(labels.nodes.map((label) => label.name));

	return Object.values(QueueRoute)
		.filter((route) => names.has(settings.routeLabels[route]))
		.map((route) => toTicketSummary({ issue, route }));
};

/**
 * The resume path's lookup: these exact tickets, fetched with NO status filter.
 *
 * A ticket parked mid-drain sits at the in-progress status, which is exactly
 * what `listEligibleTickets`'s status filter hides — so the worktree directory
 * is the durable record of parked work, and this is how its tickets are read
 * back.
 *
 * A ticket matching more than one route label yields one summary per match, so
 * the drain's double-label skip sees it exactly as it sees one from the
 * eligible list.
 */
export const getTicketsByIdentifiers = async ({ settings, identifiers }: Params): Promise<TicketSummary[] | QueueFailure> => {
	const issueNumbers = readIssueNumbers({ identifiers });

	if (issueNumbers.length === 0) {
		return [];
	}

	return runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const connection = await client.issues({ filter: { team: { key: { eq: settings.team } }, number: { in: issueNumbers } } });
			const issues = await collectIssues({ connection });
			const routed = await Promise.all(issues.map((issue) => toRoutedSummaries({ issue, settings })));

			return routed.flat();
		},
	});
};
