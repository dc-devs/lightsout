import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { pathExists, planNameFromPath, planWorkspaceDir, readPlanTicketRef, restorePlanWorkspace } from '#src/plan/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	cwd: string;
	/** The --plan value exactly as the user gave it. */
	planPath: string;
	/** Where the "fetched from the ticket" line goes — stdout by default, so a test reads what was printed. */
	write?: (line: string) => void;
}

/**
 * Make sure the plan folder a `--plan` value names is on disk, fetching it from
 * the folder's own ticket when it is not, and answer one sentence naming both
 * places when neither has a plan.
 *
 * Local disk wins outright, which is what lets a repo that commits its plan
 * folders work with no tracker at all: a folder that is already there is never
 * overwritten, merged into or deleted, whatever the ticket carries.
 *
 * The fetch is here, at the command edge, rather than inside
 * `resolvePlanDeliverable`: that resolver is shared by the read-only `plan
 * dedup` and `plan grade` passes, and a network call in it would make every
 * detection pass reach the tracker unannounced.
 *
 * It never throws for a tracker or restore reason and never exits — it hands back one
 * sentence and lets the caller own the exit code, the way every other input
 * check in `implementCommand` does.
 */
export const ensurePlanWorkspace = async ({ cwd, planPath, write = console.log }: Params): Promise<{ error: string } | undefined> => {
	const name = planNameFromPath({ cwd, planPath });

	// A `--plan` pointing anywhere outside the repo's plans directory is nobody's
	// plan workspace and has no ticket to ask.
	if (name === undefined) {
		return undefined;
	}

	const dir = planWorkspaceDir({ cwd, name });

	if (await pathExists({ path: dir })) {
		return undefined;
	}

	// Unguarded: a config the engine cannot parse must fail loudly here, exactly
	// as it does for every other `implement` step.
	const config = await readOptionalConfig({ cwd });

	if (config === undefined) {
		return { error: `no plan at ${dir}, and no plan could be fetched from the ticket: this repo has no lightsout.config.json, so it names no ticket tracker` };
	}

	const trackerSettings = resolveTrackerSettings({ config, env: process.env });

	if ('error' in trackerSettings) {
		return { error: `no plan at ${dir}, and no plan could be fetched from the ticket: ${trackerSettings.error}` };
	}

	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return {
			error: `no plan at ${dir}, and the ticket to fetch one from cannot be read: ship.ticket-pattern is not a regular expression capturing a 'ticket' group`,
		};
	}

	const identifier = readPlanTicketRef({ name, ticketPattern: shipSettings.ticketPattern });

	if (identifier === undefined) {
		return {
			error: `no plan at ${dir}, and no plan could be fetched from a ticket: the plan folder name '${name}' carries no ticket id matching this repo's ship.ticket-pattern`,
		};
	}

	const { restored, error } = await restorePlanWorkspace({ cwd, name, identifier, settings: trackerSettings });

	if (error !== undefined) {
		return { error: `no plan at ${dir}, and the plan attachments on ticket ${identifier} could not be restored: ${error}` };
	}

	if (restored.length === 0) {
		return {
			error: `no plan at ${dir}, and ticket ${identifier} carries no plan attachment — run \`lightsout plan publish --name ${name}\` from the machine that has the plan`,
		};
	}

	write(`lightsout: fetched ${restored.length} plan file(s) from ticket ${identifier} into ${dir}`);

	return undefined;
};
