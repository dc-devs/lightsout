import type { TrackerSettings } from '#src/ticketTracker/index.ts';

/**
 * A resolved tracker identity for tests, with whatever the test is actually
 * about overridden.
 *
 * One copy rather than one per test file: the settings are what every tracker
 * operation is guaranteed, so a new field must be added in one place or the
 * files that forgot it stop compiling for no reason a reader can act on.
 */
export const trackerSettingsFixture = (overrides: Partial<TrackerSettings> = {}): TrackerSettings => ({
	team: 'LO',
	apiKey: 'lin_key',
	...overrides,
});
