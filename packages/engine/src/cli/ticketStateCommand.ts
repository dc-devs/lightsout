import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { readConfig } from '#src/common/config/readConfig.ts';
import { PlanningStatus } from '#src/common/constants/PlanningStatus.ts';
import { resolveLifecycleSettings, TrackerStatusRole, updateTicketLifecycle } from '#src/ticketLifecycle/index.ts';
import { getTicketsByIdentifiers, resolveTrackerSettings } from '#src/ticketTracker/index.ts';

/** The roles this command accepts. `Done` is deliberately absent — see the command's own doc comment. */
const writableStatusRoles = [TrackerStatusRole.Ready, TrackerStatusRole.InProgress];

/** The flag's word as the engine's planning status, or the message naming what it could have been. */
const parsePlanningStatus = ({ value }: { value: string }) => {
	const matched = Object.values(PlanningStatus).find((status) => status === value);

	return matched ?? { error: `unknown planning status '${value}' — expected one of ${Object.values(PlanningStatus).join(', ')}` };
};

/** The flag's word as a status role, or the message saying which two roles a caller may write. */
const parseTrackerStatusRole = ({ value }: { value: string }) => {
	const matched = writableStatusRoles.find((role) => role === value);

	if (matched !== undefined) {
		return matched;
	}

	const refusal =
		value === TrackerStatusRole.Done
			? "'done' is not written by hand: a ticket reaches done only when a merge is positively confirmed, which the ship path writes from the merged pull request the forge reported"
			: `unknown tracker status '${value}'`;

	return { error: `${refusal} — expected one of ${writableStatusRoles.join(', ')}` };
};

/**
 * `lightsout ticket-state` — write a ticket's planning status, its tracker
 * workflow status, or both.
 *
 * The deterministic write a workflow skill shells out to at each transition, the
 * way the plan skills already shell out to `lightsout plan publish`: an agent
 * left to its own tracker tooling can neither be relied on nor fail the run, and
 * a non-zero exit here is how the caller learns the write did not happen.
 *
 * `--tracker-status` takes the engine's *role* rather than a repository's own
 * spelling, so one skill line works in every repository and
 * `updateTicketLifecycle` stays the single place a role becomes a status name.
 * It does not accept `done`: tracker completion must reflect shipped code, so
 * every done write in the engine runs downstream of a merged pull request the
 * forge reported, and a flag that could set it without that evidence is exactly
 * the hole that rule closes.
 *
 * `readConfig` rather than the optional reader, for the reason
 * `planPublishCommand` gives: this needs a `ticket-tracker` block, so a
 * repository with no config has nothing to resolve and is refused by name.
 */
export const ticketStateCommand = async ({ flags, cwd }: CommandContext): Promise<void> => {
	const ref = await getRequiredFlag({ flags, name: 'ref' });
	const planningStatusFlag = getStringFlag({ flags, name: 'planning-status' });
	const trackerStatusFlag = getStringFlag({ flags, name: 'tracker-status' });

	if (planningStatusFlag === undefined && trackerStatusFlag === undefined) {
		console.error('ticket-state needs at least one of --planning-status or --tracker-status');
		return exitCli({ code: 1 });
	}

	const planningStatus = planningStatusFlag === undefined ? undefined : parsePlanningStatus({ value: planningStatusFlag });

	if (typeof planningStatus === 'object') {
		console.error(planningStatus.error);
		return exitCli({ code: 1 });
	}

	const trackerStatus = trackerStatusFlag === undefined ? undefined : parseTrackerStatusRole({ value: trackerStatusFlag });

	if (typeof trackerStatus === 'object') {
		console.error(trackerStatus.error);
		return exitCli({ code: 1 });
	}

	const config = await readConfig({ cwd });
	const trackerSettings = resolveTrackerSettings({ config, env: process.env });

	if ('error' in trackerSettings) {
		console.error(trackerSettings.error);
		return exitCli({ code: 1 });
	}

	const lifecycle = resolveLifecycleSettings({ config });

	if ('error' in lifecycle) {
		console.error(lifecycle.error);
		return exitCli({ code: 1 });
	}

	const found = await getTicketsByIdentifiers({ settings: trackerSettings, identifiers: [ref] });

	if ('error' in found) {
		console.error(`${ref} could not be read from the tracker: ${found.error}`);
		return exitCli({ code: 1 });
	}

	const ticket = found[0];

	if (ticket === undefined) {
		console.error(`the tracker returned no ticket with the identifier ${ref}`);
		return exitCli({ code: 1 });
	}

	const failure = await updateTicketLifecycle({
		lifecycle,
		trackerSettings,
		ticketId: ticket.id,
		planningStatus,
		trackerStatus,
		currentStatus: ticket.status,
	});

	if (failure !== undefined) {
		console.error(`${ref} could not be written: ${failure.error}`);
		return exitCli({ code: 1 });
	}

	const written = [
		planningStatus === undefined ? undefined : `planning status '${lifecycle.planningStatusLabels[planningStatus]}'`,
		trackerStatus === undefined ? undefined : `tracker status '${lifecycle.statusNames[trackerStatus]}'`,
	].filter((part) => part !== undefined);

	console.log(`${ref}: ${written.join(' and ')}`);

	return exitCli({ code: 0 });
};
