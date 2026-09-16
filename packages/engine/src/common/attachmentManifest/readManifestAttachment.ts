import { readTicketAsset, type TrackerAttachment, type TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	settings: TrackerSettings;
	attachment: TrackerAttachment;
}
export const readManifestAttachment = async ({ settings, attachment }: Params): Promise<{ text: string } | { error: string }> => {
	const text = await readTicketAsset({ settings, url: attachment.url });
	return typeof text === 'string' ? { text } : { error: `the ticket's ${attachment.title} could not be read: ${text.error}` };
};
