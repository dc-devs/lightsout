import type { ShipIntegration } from '#src/ship/index.ts';
import { createUncalledDriver } from '#tests/helpers/createUncalledDriver.ts';

/**
 * The config and harness a ship recovers with, for tests, with whatever the
 * test is actually about overridden.
 *
 * The driver defaults to one that must never be spawned, so a test that does
 * not expect a recovery fails loudly when one happens; a test that does expect
 * one hands in its own. One copy rather than one per file, for the reason
 * `shipSettingsFixture` is one copy.
 */
export const shipIntegrationFixture = (overrides: Partial<ShipIntegration> = {}): ShipIntegration => ({
	config: { gates: { check: 'true', test: 'true', 'test-coverage': false }, 'standards-packs': false },
	driver: createUncalledDriver({ reason: 'the ship integration spawned a harness the test did not arrange one for' }),
	...overrides,
});
