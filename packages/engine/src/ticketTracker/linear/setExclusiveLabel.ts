import type { IssueLabel, LinearClient } from '@linear/sdk';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { buildLabelScopeFilter } from '#src/ticketTracker/linear/common/utils/buildLabelScopeFilter.ts';
import { collectNodes } from '#src/ticketTracker/linear/common/utils/collectNodes.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	ticketId: string;
	label: string;
	groupLabels: string[];
}

/**
 * The id to add for one label name, preferring a team-scoped match over a
 * workspace-level one.
 *
 * The scope filter asks for the team's labels *or* labels with no team, so two
 * different labels may answer to the same name. Any of them satisfies a reader
 * comparing by name, but preferring the team's own keeps two runs on the same
 * workspace from disagreeing about which id they added.
 */
const targetLabelIdOf = ({ catalog, label }: { catalog: IssueLabel[]; label: string }) => {
	const matches = catalog.filter((node) => node.name === label);

	return (matches.find((node) => node.teamId !== undefined) ?? matches.at(0))?.id;
};

/**
 * Adds the target label, putting the siblings back when the add is rejected.
 *
 * The removals have already landed by this point, so a failed add would leave
 * the ticket carrying no member of the group at all — a state nothing heals,
 * because a caller reads "no label" as "not delegated" and never comes back to
 * it. A rollback that itself fails is acceptable: it is a second chance at the
 * as-found state, not a guarantee, and the original failure is what the caller
 * is told about either way.
 */
const addTargetLabel = async ({ client, ticketId, targetId, removed }: { client: LinearClient; ticketId: string; targetId: string; removed: IssueLabel[] }) => {
	try {
		await client.issueAddLabel(ticketId, targetId);
	} catch (error) {
		for (const node of removed) {
			await client.issueAddLabel(ticketId, node.id).catch(() => undefined);
		}

		throw error;
	}
};

/**
 * Makes `label` the one member of `groupLabels` the ticket carries.
 *
 * Labels outside `groupLabels` are never touched, and writing nothing is a
 * legitimate outcome: a ticket already carrying exactly `label` costs two reads
 * and no write.
 *
 * The siblings are removed *before* the target is added, and the obvious order
 * is the wrong one. When the group is configured as a Linear label group —
 * which is what makes "exactly one" a tracker guarantee — the add drops the
 * siblings server-side, so removals issued after it would target labels the
 * issue no longer carries. Whether Linear rejects such a removal is live-API
 * behaviour this folder cannot check by compiling, and a rejection here becomes
 * a `TrackerFailure` that parks the ticket — so a correctly configured
 * workspace could park everything while its tracker state was in fact right.
 * Removing first makes every operation act on a label the issue was just read
 * as carrying, in a grouped and an ungrouped workspace alike. The cost is a
 * window in which the ticket carries no member of the group, which every reader
 * already treats as "not delegated": a missed pickup that the next pass heals.
 *
 * The siblings are removed by the id the issue itself reports rather than by a
 * name-keyed catalog entry, because the scope filter can answer two labels
 * sharing one name and removing the wrong id is a silent no-op.
 *
 * This never creates a label. Whether every configured label exists is one
 * question, answered once by `listLabelNames` at the caller's startup rather
 * than silently, per ticket, at write time.
 */
export const setExclusiveLabel = async ({ settings, ticketId, label, groupLabels }: Params): Promise<TrackerFailure | undefined> =>
	runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const filter = { name: { in: groupLabels }, or: buildLabelScopeFilter({ team: settings.team }) };
			const catalog = await collectNodes({ connection: await client.issueLabels({ filter }) });
			const targetId = targetLabelIdOf({ catalog, label });

			if (targetId === undefined) {
				return { error: `the '${settings.team}' team has no '${label}' label` };
			}

			const issue = await client.issue(ticketId);
			const carried = await collectNodes({ connection: await issue.labels() });
			const siblings = carried.filter((node) => node.name !== label && groupLabels.includes(node.name));

			for (const sibling of siblings) {
				await client.issueRemoveLabel(ticketId, sibling.id);
			}

			if (!carried.some((node) => node.name === label)) {
				await addTargetLabel({ client, ticketId, targetId, removed: siblings });
			}

			return undefined;
		},
	});
