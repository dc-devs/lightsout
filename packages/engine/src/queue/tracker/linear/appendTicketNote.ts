import type { LinearQueueSettings } from '#src/queue/common/types/LinearQueueSettings.ts';
import type { QueueFailure } from '#src/queue/common/types/QueueFailure.ts';
import { addLineUnderHeading } from '#src/queue/tracker/common/utils/addLineUnderHeading.ts';
import { runLinear } from '#src/queue/tracker/runLinear.ts';

interface Params {
	settings: LinearQueueSettings;
	ticketId: string;
	heading: string;
	line: string;
}

export const appendTicketNote = async ({ settings, ticketId, heading, line }: Params): Promise<QueueFailure | undefined> => {
	const written = await runLinear({
		apiKey: settings.apiKey,
		call: async (client) => {
			const issue = await client.issue(ticketId);
			const description = addLineUnderHeading({ body: issue.description ?? '', heading, line });

			await client.updateIssue(ticketId, { description });
			return undefined;
		},
	});

	return written;
};
