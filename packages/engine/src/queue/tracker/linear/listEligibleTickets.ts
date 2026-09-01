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
}

export const listEligibleTickets = async ({ settings }: Params): Promise<TicketSummary[] | QueueFailure> => {
	const routes = Object.values(QueueRoute);

	return runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const perRoute = await Promise.all(
				routes.map(async (route) => {
					const connection = await client.issues({
						filter: {
							team: { key: { eq: settings.team } },
							labels: { name: { eq: settings.routeLabels[route] } },
							state: { name: { in: settings.eligibleStatuses } },
						},
					});
					const issues = await collectNodes({ connection });

					return Promise.all(issues.map(async (issue) => toTicketSummary({ issue, route, unfinishedBlockers: await getUnfinishedBlockers({ issue }) })));
				}),
			);

			return perRoute.flat();
		},
	});
};
