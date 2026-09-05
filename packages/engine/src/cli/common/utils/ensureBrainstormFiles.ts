import { restoreBrainstormFiles } from '#src/brainstorm/index.ts';
import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { planWorkspaceDir, readPlanTicketRef } from '#src/plan/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the fetched files land in. */
	name: string;
	/** Where the "fetched from the ticket" line goes — stdout by default, so a test reads what was printed. */
	write?: (line: string) => void;
}

/**
 * Fetch a ticket's published brainstorm into its plan folder, at planning's
 * first command edge.
 *
 * It answers nothing and never blocks, which is the one way it differs from
 * `ensurePlanWorkspace`: planning must still run in a repo with no
 * `lightsout.config.json`, and a ticket with no published brainstorm is the
 * ordinary case rather than a failure. Only a tracker read that was attempted
 * and failed prints anything, and planning carries on regardless.
 */
export const ensureBrainstormFiles = async ({ cwd, name, write = console.log }: Params): Promise<void> => {
	// Unguarded: a config the engine cannot parse must fail loudly here, exactly
	// as it does in `ensurePlanWorkspace`.
	const config = await readOptionalConfig({ cwd });

	if (config === undefined) {
		return;
	}

	const trackerSettings = resolveTrackerSettings({ config, env: process.env });
	const shipSettings = resolveShipSettings({ config });

	if ('error' in trackerSettings || shipSettings === undefined) {
		return;
	}

	const identifier = readPlanTicketRef({ name, ticketPattern: shipSettings.ticketPattern });

	if (identifier === undefined) {
		return;
	}

	const { restored, skipped, error } = await restoreBrainstormFiles({ cwd, name, identifier, settings: trackerSettings });

	if (error !== undefined) {
		write(`lightsout: could not fetch the brainstorm from ticket ${identifier}: ${error}`);
		return;
	}

	if (restored.length > 0) {
		write(`lightsout: fetched ${restored.length} brainstorm file(s) from ticket ${identifier} into ${planWorkspaceDir({ cwd, name })}`);
	}

	if (skipped.length > 0) {
		write(`lightsout: kept the local ${skipped.join(', ')} — ticket ${identifier} also carries ${skipped.length > 1 ? 'them' : 'it'}`);
	}
};
