/**
 * The host manifests the shipped-parity check compares, as repository-relative
 * paths.
 *
 * One list rather than one per test file, so the clone fixture and the cases
 * that read versions out of it cannot drift onto different manifests.
 */
export const shippedManifestPaths = {
	claude: 'plugin/.claude-plugin/plugin.json',
	codex: 'plugin/.codex-plugin/plugin.json',
	addOnClaude: 'plugin-linear/.claude-plugin/plugin.json',
	addOnCodex: 'plugin-linear/.codex-plugin/plugin.json',
} as const;
