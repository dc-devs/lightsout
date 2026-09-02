import { messageOf } from '#src/common/utils/messageOf.ts';
import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { TrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';

interface Params {
	settings: TrackerSettings;
	/** A `TrackerAttachment.url` — the tracker's permanent asset URL. */
	url: string;
}

/**
 * The bytes behind an attachment's asset URL, as text.
 *
 * An uploaded asset is not public, so the request carries the tracker API key —
 * which is the whole reason this read lives inside the tracker module: nothing
 * above the seam ever holds the key, and a second tracker stays a change inside
 * this folder.
 *
 * It does not go through `runLinear`, which builds a client and takes a GraphQL
 * call; an asset download is neither. It keeps that function's two contracts
 * instead — the same 60s deadline, and a returned failure rather than a throw —
 * so a caller reads it exactly like every other operation here.
 *
 * Text is the whole contract: every durable plan file is UTF-8 markdown or
 * JSON, and there is no binary case to carry.
 */
export const readTicketAsset = async ({ settings, url }: Params): Promise<string | TrackerFailure> => {
	const trackerTimeoutMs = 60_000;

	try {
		// The key goes in bare, with no `Bearer` prefix — the form a Linear
		// personal API key takes, and the form the SDK's own client sends.
		const response = await fetch(url, { headers: { Authorization: settings.apiKey }, signal: AbortSignal.timeout(trackerTimeoutMs) });

		return response.ok ? await response.text() : { error: `the tracker refused ${url}: HTTP ${response.status}` };
	} catch (error) {
		return { error: messageOf({ error }) };
	}
};
