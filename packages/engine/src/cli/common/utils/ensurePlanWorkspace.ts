import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { parsePlanAddress } from '#src/common/planAddress/parsePlanAddress.ts';
import { workOrderNameOf } from '#src/common/planAddress/workOrderNameOf.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import { pathExists, planNameFromPath, planWorkspaceDir, readPlanWorkOrderRef } from '#src/plan/index.ts';
import { resolveShipSettings } from '#src/ship/index.ts';
import { resolveTrackerSettings } from '#src/ticketTracker/index.ts';
import { pullWorkOrderState, restoreWorkOrderPlan } from '#src/workOrder/index.ts';
import { resolveWorktreePath } from '#src/worktree/index.ts';

interface Params {
	cwd: string;
	/** The --plan value exactly as the user gave it. */
	planPath: string;
	/** Where the "fetched from the ticket" line goes — stdout by default, so a test reads what was printed. */
	write?: (line: string) => void;
}

interface TicketSource {
	config: LightsoutConfig;
	/** The ticket reference the folder's name carries, e.g. 'lo-54'. */
	identifier: string;
}

/**
 * Everything needed to ask a ticket for a plan, or the one sentence saying
 * which part of it this repo does not have.
 *
 * Every sentence names the folder that is missing first, because that is the
 * problem the user is actually looking at; the tracker is only why it could not
 * be solved for them.
 */
const readTicketSource = async ({ cwd, name, dir }: { cwd: string; name: string; dir: string }): Promise<TicketSource | { error: string }> => {
	// Unguarded: a config the engine cannot parse must fail loudly here, exactly
	// as it does for every other `implement` step.
	const config = await readOptionalConfig({ cwd });

	if (config === undefined) {
		return { error: `no plan at ${dir}, and no plan could be fetched from the ticket: this repo has no lightsout.config.json, so it names no ticket tracker` };
	}

	const settings = resolveTrackerSettings({ config, env: process.env });

	if ('error' in settings) {
		return { error: `no plan at ${dir}, and no plan could be fetched from the ticket: ${settings.error}` };
	}

	const shipSettings = resolveShipSettings({ config });

	if (shipSettings === undefined) {
		return {
			error: `no plan at ${dir}, and the ticket to fetch one from cannot be read: ship.ticket-pattern is not a regular expression capturing a 'ticket' group`,
		};
	}

	const identifier = readPlanWorkOrderRef({ name, ticketPattern: shipSettings.ticketPattern });

	return identifier === undefined
		? {
				error: `no plan at ${dir}, and no plan could be fetched from a ticket: the plan folder name '${name}' carries no ticket id matching this repo's ship.ticket-pattern`,
			}
		: { config, identifier };
};

/**
 * Settle the ticket's record into this machine, then write the addressed plan's
 * own generation into its folder.
 *
 * The record comes first because it is what says the plan exists at all, and a
 * record this machine cannot settle — one that moved here and on the ticket —
 * has to stop the run rather than be worked around: the plan restored under it
 * could be from either side of the divergence.
 */
const fetchTicketPlan = async ({
	cwd,
	name,
	dir,
	tree,
	identifier,
	config,
	write,
}: {
	cwd: string;
	name: string;
	dir: string;
	tree: string;
	identifier: string;
	config: LightsoutConfig;
	write: (line: string) => void;
}) => {
	const workOrderName = workOrderNameOf({ name });
	const pulled = await pullWorkOrderState({ cwd, name: workOrderName, config, env: process.env, onProgress: write });

	if ('error' in pulled) {
		return { error: `no plan at ${dir}, and the ticket record for '${workOrderName}' could not be settled: ${pulled.error}` };
	}

	const restored = await restoreWorkOrderPlan({ cwd, address: name, config, env: process.env, onProgress: write });

	if ('error' in restored) {
		return { error: `no plan at ${dir}, and the plan attachments on ticket ${identifier} could not be restored: ${restored.error}` };
	}

	if (restored.restored.length === 0) {
		return {
			error: `no plan at ${dir} or in the plan's worktree at ${tree}, and ticket ${identifier} carries no attachment for that plan — run \`lightsout plan publish --name ${name}\` from the machine that has the plan`,
		};
	}

	write(`lightsout: fetched ${restored.restored.length} plan file(s) from ticket ${identifier} into ${dir}`);

	return undefined;
};

/**
 * Make sure the plan folder a `--plan` value names is on disk — fetching it from
 * the folder's own ticket when it is not — and answer one sentence naming every
 * place looked when none has a plan.
 *
 * A `--plan` value that is not a plan address is left exactly as it was found:
 * every plan lives at `<work-order>/<plan-id>`, so a path that is not one names
 * no plan a ticket could be asked for, and nothing is restored into it.
 *
 * Local disk wins outright, which is what lets a repo that commits its plan
 * folders work with no tracker at all: a folder that is already there is never
 * overwritten, merged into or deleted, whatever the ticket carries.
 *
 * There is no nearer source than disk. A plan folder lives in the main checkout
 * whichever checkout a plan command ran from, so a plan planning finished is
 * already the folder this gate just looked at, and no worktree ever holds a copy
 * to recover.
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
	const name = await planNameFromPath({ cwd, planPath });

	// A `--plan` pointing anywhere outside the repo's plans directory is nobody's
	// plan workspace and has no ticket to ask.
	if (name === undefined) {
		return undefined;
	}

	const dir = await planWorkspaceDir({ cwd, name });

	if (await pathExists({ path: dir })) {
		return undefined;
	}

	const source = await readTicketSource({ cwd, name, dir });

	if ('error' in source) {
		return source;
	}

	const { config, identifier } = source;

	return parsePlanAddress({ name }) === undefined
		? undefined
		: fetchTicketPlan({ cwd, name, dir, tree: await resolveWorktreePath({ cwd, branch: workOrderNameOf({ name }) }), identifier, config, write });
};
