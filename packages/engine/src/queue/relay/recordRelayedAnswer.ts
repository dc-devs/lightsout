import { join } from 'node:path';
import { z } from 'zod';
import { appendJsonlRecords } from '#src/common/utils/appendJsonlRecords.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import { appendTicketNote } from '#src/queue/tracker/index.ts';

/**
 * One relayed question and its answer, as persisted to the coordinator run's
 * `decisions.jsonl` — the entry plus the provenance `appendJsonlRecords`
 * stamps on every record.
 */
const QueueQuestionRecord = z.object({
	question: z.string(),
	answer: z.string(),
	ticket: z.string(),
	at: z.string(),
	runId: z.string(),
	step: z.string(),
});

interface Params {
	settings: QueueSettings;
	question: string;
	answer: string;
	ticket: TicketSummary;
	/** The coordinator run's id — `appendJsonlRecords` stamps it on every record. */
	coordinatorRunId: string;
	/** The queue's own run directory in the main checkout — the one place the queue writes records. */
	coordinatorRunDir: string;
	/** Where a failed ticket write is reported; the answer is already on disk, so it never throws. */
	onProgress: (message: string) => void;
}

/**
 * One relayed answer, kept in the coordinator run's `decisions.jsonl` and on
 * the ticket, before the worker sees it.
 *
 * A worktree's `.lightsout` belongs to the worker running in it, so the queue's
 * copy lives with the queue's own run, tagged per ticket.
 */
export const recordRelayedAnswer = async ({ settings, question, answer, ticket, coordinatorRunId, coordinatorRunDir, onProgress }: Params): Promise<void> => {
	await appendJsonlRecords({
		path: join(coordinatorRunDir, 'decisions.jsonl'),
		schema: QueueQuestionRecord,
		entries: [{ question, answer, ticket: ticket.identifier }],
		runId: coordinatorRunId,
		step: 'queue-question',
	});

	const noted = await appendTicketNote({
		settings,
		ticketId: ticket.id,
		heading: settings.decisionsHeading,
		line: `- ${question} → ${answer}`,
	});

	if (noted !== undefined) {
		// The answer is already on the worker's disk; losing the ticket copy must
		// not cost the run.
		onProgress(`the answer could not be written to the ticket: ${noted.error}`);
	}
};
