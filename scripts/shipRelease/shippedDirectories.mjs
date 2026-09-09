import { join } from 'node:path';

/**
 * The directories a marketplace install copies, with every host manifest that
 * names the same build.
 *
 * One list rather than one per script: `preShip.mjs` bumps exactly what
 * `checkShipped.mjs` then verifies, so a fourth plugin added to one copy and
 * not the other would ship unversioned or fail a check nothing prepared.
 */
export const shippedDirectories = [
	{
		dir: 'plugin',
		primaryManifestPath: join('plugin', '.claude-plugin', 'plugin.json'),
		manifestPaths: [join('plugin', '.claude-plugin', 'plugin.json'), join('plugin', '.codex-plugin', 'plugin.json')],
	},
	{
		dir: 'plugin-linear',
		primaryManifestPath: join('plugin-linear', '.claude-plugin', 'plugin.json'),
		manifestPaths: [join('plugin-linear', '.claude-plugin', 'plugin.json'), join('plugin-linear', '.codex-plugin', 'plugin.json')],
	},
	{
		dir: 'plugin-jira',
		primaryManifestPath: join('plugin-jira', '.claude-plugin', 'plugin.json'),
		manifestPaths: [join('plugin-jira', '.claude-plugin', 'plugin.json'), join('plugin-jira', '.codex-plugin', 'plugin.json')],
	},
];
