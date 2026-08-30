import type { ShipSettings } from '#src/ship/common/types/ShipSettings.ts';

/** What `--ship`, `--no-ship`, `ship.after-implement` and `LIGHTSOUT_NO_SHIP` amount to — see {@link resolveShipIntent}. */
export interface ShipIntent {
	/** Both `--ship` and `--no-ship` were typed: a usage error, reported by whichever caller sees it first. */
	contradictory: boolean;
	/** A passing run will attempt to ship this branch. False when suppressed, when nobody asked, and when the flags contradict. */
	willShip: boolean;
	/** The resolved ship block, or undefined when the configured ticket pattern cannot do its job. */
	settings: ShipSettings | undefined;
}
