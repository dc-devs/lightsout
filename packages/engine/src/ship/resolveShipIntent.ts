import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { ShipIntent } from '#src/ship/common/types/ShipIntent.ts';
import { resolveShipSettings } from '#src/ship/resolveShipSettings.ts';

interface Params {
	config: LightsoutConfig;
	/** Whether `--ship` was typed. The config's `after-implement` is the other way in. */
	shipFlag: boolean;
	/** Whether `--no-ship` was typed. Beats the config's `after-implement`. */
	noShipFlag: boolean;
	/** The process environment, read for the queue's own suppression variable. Passed rather than read, so a test never needs to mutate `process.env`. */
	env: NodeJS.ProcessEnv;
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
 */
export const resolveShipIntent = ({ config, shipFlag, noShipFlag, env }: Params): ShipIntent => {
	const settings = resolveShipSettings({ config });
	const contradictory = shipFlag && noShipFlag;
	const suppressed = noShipFlag || (env.LIGHTSOUT_NO_SHIP ?? '') !== '';
	const willShip = !contradictory && !suppressed && (shipFlag || settings?.afterImplement === true);

	return { contradictory, willShip, settings };
};
