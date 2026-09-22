import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { ShipIntent } from '#src/ship/common/types/ShipIntent.ts';
import type { ShipRequestTerms } from '#src/ship/common/types/ShipRequestTerms.ts';
import { resolveShipSettings } from '#src/ship/resolveShipSettings.ts';

interface Params {
	config: LightsoutConfig;
	/** Whether `--ship` was typed. The config's `after-implement` is the other way in. */
	shipFlag: boolean;
	/** Whether `--no-ship` was typed. Beats the config's `after-implement`. */
	noShipFlag: boolean;
	/** The process environment, read for the queue's own suppression variable. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
	/** The ticket's own terms for this run, from `readWorkOrderRunTerms`. Present only when the branch's ticket record decides the shipping rather than the flags. */
	shipRequest?: ShipRequestTerms;
}

/**
 * Whether this run intends to ship, decided before the run starts.
 *
 * The rule used to live at the exit path, which runs after the work is done —
 * so the manifest could not record what the run was going to do, and the
 * progress view could not show a ship row. Deciding once, here, is what lets
 * the stamp on the manifest and the eventual exit agree by construction.
 *
 * Two things beat every request to ship. `--ship --no-ship` together is a
 * contradiction. `LIGHTSOUT_NO_SHIP` in the environment wins silently over
 * both flag and config: the queue sets it for its worker sessions, whose
 * branches only the drain's own serial merge may ship.
 *
 * `willShip` can be true while `settings` is undefined — `--ship` against an
 * unusable ticket pattern. That is deliberate: the run intended to ship, so the
 * progress table shows the row, and the exit path still refuses with the
 * message that names the key.
 *
 * A `shipRequest` takes the decision away from `--ship` and
 * `ship.after-implement` entirely: a multiple-plan work order ships when the human's
 * explicit request is satisfied by this run and at no other time, which is what
 * "switching to multiple-plan mode disables automatic shipping" means in
 * practice. The two rules above still beat it, and a run they stopped carries no
 * `shipRequestBlocker` — nothing about the ticket held it back.
 */
export const resolveShipIntent = ({ config, shipFlag, noShipFlag, env, shipRequest }: Params): ShipIntent => {
	const settings = resolveShipSettings({ config });
	const contradictory = shipFlag && noShipFlag;
	const suppressed = noShipFlag || (env.LIGHTSOUT_NO_SHIP ?? '') !== '';
	const asked = shipRequest === undefined ? shipFlag || settings?.afterImplement === true : shipRequest.blocker === undefined;
	const stopped = contradictory || suppressed;

	return {
		contradictory,
		willShip: !stopped && asked,
		settings,
		// The field exists only where a ticket record had a say at all, and carries a
		// sentence only where that say is what held the run back.
		...(shipRequest === undefined ? {} : { shipRequestBlocker: stopped ? undefined : shipRequest.blocker }),
	};
};
