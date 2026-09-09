import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';

/**
 * The tools ship's integration step needs and `ShipSettings` cannot carry,
 * because they are not the `ship` config block: the effective config the
 * post-integration gates run from, and the harness a bounded recovery spawns.
 *
 * A required parameter of `runShip` rather than an optional one — the compiler
 * is what stops a fourth shipping path from being added without the safety
 * contract.
 */
export interface ShipIntegration {
	config: LightsoutConfig;
	driver: Driver;
}
