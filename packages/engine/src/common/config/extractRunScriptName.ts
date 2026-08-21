interface Params {
	command: string;
}

/**
 * Pull the script name out of a `... run <script>` shaped command — the
 * convention every workspace runner shares (`pnpm --filter x run check`,
 * `npm run check --workspace=x`, `turbo run check`). Flag tokens after
 * `run` (e.g. `--if-present`) are stepped over. Returns undefined when the
 * command has no standalone `run` token or nothing follows it — callers
 * must treat that as "unknown", not "missing".
 */
export const extractRunScriptName = ({ command }: Params): string | undefined => {
	const tokens = command.split(/\s+/);
	const runIndex = tokens.indexOf('run');

	if (runIndex === -1) {
		return undefined;
	}

	return tokens.slice(runIndex + 1).find((token) => token !== '' && !token.startsWith('-'));
};
