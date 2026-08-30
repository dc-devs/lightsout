/**
 * The `queue` block a repo writes into `lightsout.config.json` when it has a
 * tracker, in the file's own kebab-case spelling — the raw counterpart of
 * `queueSettingsFixture`, which is the block after resolution.
 *
 * One copy rather than one per test file, for the same reason: it is the
 * smallest block `ConfigQueue` accepts, so a new required key is added here
 * once instead of in every file that plants a config.
 */
export const queueConfigBlock = {
	tracker: 'linear',
	team: 'LO',
	'route-labels': { direct: 'route-direct', 'auto-plan': 'route-auto-plan' },
	'max-parallel': 2,
	'api-key-env': 'LINEAR_API_KEY',
};
