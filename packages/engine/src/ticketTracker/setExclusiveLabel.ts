import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { setExclusiveLabel as setJiraExclusiveLabel } from '#src/ticketTracker/jira/index.ts';
import { setExclusiveLabel as setLinearExclusiveLabel } from '#src/ticketTracker/linear/index.ts';

interface Params {
	settings: TrackerSettings;
	ticketId: string;
	/** The one label of `groupLabels` the ticket carries when this returns. */
	label: string;
	/** Every label in the mutually exclusive group, `label` included. */
	groupLabels: string[];
}

/**
 * Makes one label of a mutually exclusive group the only member of that group a
 * ticket carries.
 *
 * When this returns `undefined` the ticket carries `label` and none of the
 * other members of `groupLabels`. Labels outside `groupLabels` are never
 * touched, and writing nothing is a legitimate outcome: a ticket already in the
 * requested state costs reads and no write.
 *
 * The removal set is `groupLabels` minus `label`, computed from the names the
 * caller passed. There is no guard that `label` is a member, because the
 * contract is stated in terms of the two lists — a caller naming a label
 * outside the group still gets a well-defined result.
 *
 * This never creates a label on Linear. Whether every configured label exists
 * is one question, answered once by `listLabelNames` at the caller's startup
 * rather than silently, per ticket, at write time.
 */
export const setExclusiveLabel = async (params: Params): Promise<TrackerFailure | undefined> =>
	params.settings.provider === 'linear'
		? setLinearExclusiveLabel({ ...params, settings: params.settings })
		: setJiraExclusiveLabel({ ...params, settings: params.settings });
