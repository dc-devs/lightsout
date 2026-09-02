import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { LinearTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { addLineUnderHeading } from '#src/ticketTracker/common/utils/addLineUnderHeading.ts';
import { runLinear } from '#src/ticketTracker/linear/runLinear.ts';

interface Params {
	settings: LinearTrackerSettings;
	ticketId: string;
	heading: string;
	line: string;
}

export const appendTicketNote = async ({ settings, ticketId, heading, line }: Params): Promise<TrackerFailure | undefined> =>
	runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const issue = await client.issue(ticketId);
			const description = addLineUnderHeading({ body: issue.description ?? '', heading, line });

			await client.updateIssue(ticketId, { description });
			return undefined;
		},
	});
