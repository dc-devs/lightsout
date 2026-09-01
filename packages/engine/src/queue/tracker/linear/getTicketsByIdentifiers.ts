import type { Issue } from '@linear/sdk';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { LinearQueueSettings } from '#src/queue/common/types/LinearQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { collectNodes } from '#src/queue/tracker/common/utils/collectNodes.ts';
import { getUnfinishedBlockers } from '#src/queue/tracker/common/utils/getUnfinishedBlockers.ts';
import { toTicketSummary } from '#src/queue/tracker/common/utils/toTicketSummary.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: LinearQueueSettings;
	identifiers: string[];
}

const readIssueNumbers = ({ identifiers }: { identifiers: string[] }) =>
	identifiers.map((identifier) => Number.parseInt(identifier.split('-').at(-1) ?? '', 10)).filter((issueNumber) => Number.isFinite(issueNumber));

const toRoutedSummaries = async ({ issue, settings }: { issue: Issue; settings: LinearQueueSettings }) => {
	const labels = await collectNodes({ connection: await issue.labels() });
	const names = new Set(labels.map((label) => label.name));
	const routes = Object.values(QueueRoute).filter((route) => names.has(settings.routeLabels[route]));

	if (routes.length === 0) {
		return [];
	}

	const unfinishedBlockers = await getUnfinishedBlockers({ issue });

	return routes.map((route) => toTicketSummary({ issue, route, unfinishedBlockers }));
};

export const getTicketsByIdentifiers = async ({ settings, identifiers }: Params): Promise<TicketSummary[] | QueueFailure> => {
	const issueNumbers = readIssueNumbers({ identifiers });

	if (issueNumbers.length === 0) {
		return [];
	}

	return runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const connection = await client.issues({ filter: { team: { key: { eq: settings.team } }, number: { in: issueNumbers } } });
			const issues = await collectNodes({ connection });
			const routed = await Promise.all(issues.map((issue) => toRoutedSummaries({ issue, settings })));

			return routed.flat();
		},
	});
};
