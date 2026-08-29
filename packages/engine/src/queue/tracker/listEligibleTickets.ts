import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { collectNodes } from '#src/queue/tracker/common/utils/collectNodes.ts';
import { getUnfinishedBlockers } from '#src/queue/tracker/common/utils/getUnfinishedBlockers.ts';
import { toTicketSummary } from '#src/queue/tracker/common/utils/toTicketSummary.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: QueueSettings;
}

/**
 * Every ticket the queue may pick up: one query per configured route label, so
 * the route is known from which query answered and no second round trip per
 * issue is needed.
 *
 * A ticket carrying both route labels comes back once per query, deliberately —
 * the adapter reports what it saw, and the drain is the one place the
 * double-label skip policy lives.
 *
 * A failure is returned rather than swallowed, so a bad key or an unreachable
 * API stops the command instead of reading as an empty backlog.
 *
 * Each returned issue costs one extra round trip for its relations plus one per
 * blocking relation, all inside the same 60s tracker deadline: Linear's issue
 * filter cannot express "has an unfinished blocker", and the blocker
 * identifiers are needed for the report either way.
 */
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
