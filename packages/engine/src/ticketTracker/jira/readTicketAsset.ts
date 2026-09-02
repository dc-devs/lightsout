import type { TrackerFailure } from '#src/ticketTracker/common/types/TrackerFailure.ts';
import type { JiraTrackerSettings } from '#src/ticketTracker/common/types/TrackerSettings.ts';
import { runJira } from '#src/ticketTracker/jira/runJira.ts';

interface Params {
	settings: JiraTrackerSettings;
	url: string;
}

export const readTicketAsset = async ({ settings, url }: Params): Promise<string | TrackerFailure> => {
	let assetUrl: URL;
	let siteUrl: URL;

	try {
		assetUrl = new URL(url);
		siteUrl = new URL(settings.siteUrl);
	} catch {
		return { error: `refusing to send tracker credentials to untrusted attachment URL '${url}'` };
	}

	if (assetUrl.origin !== siteUrl.origin || !assetUrl.pathname.startsWith('/rest/api/3/attachment/content/')) {
		return { error: `refusing to send tracker credentials to untrusted attachment URL '${url}'` };
	}

	return runJira({
		settings,
		request: (client) => client.request({ method: 'GET', path: `${assetUrl.pathname}${assetUrl.search}`, response: 'text' }),
	});
};
