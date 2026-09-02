import { ShipMergeMethod } from '#src/contracts/index.ts';
import type { ShipSettings } from '#src/ship/index.ts';

/**
 * A resolved `ship` block for tests, with whatever the test is actually about
 * overridden.
 *
 * One copy rather than one per test file, for the same reason
 * `queueSettingsFixture` is one copy: the settings are what `resolveShipSettings`
 * guarantees every step that ships a branch, so a new field must be added in one
 * place or the files that forgot it stop compiling for no reason a reader can
 * act on.
 */
export const shipSettingsFixture = (overrides: Partial<ShipSettings> = {}): ShipSettings => ({
	ticketPattern: /^(?<ticket>[a-z]+-\d+)/,
	pullRequestBody: '{ticket}',
	mergeMethod: ShipMergeMethod.Merge,
	afterImplement: false,
	preShip: undefined,
	...overrides,
});
