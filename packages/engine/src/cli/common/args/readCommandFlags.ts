import { usage } from '#src/cli/common/constants/usage.ts';

interface Params {
	command: string;
}

/** The command a usage line describes — the word right after `lightsout`. */
const commandOf = ({ line }: { line: string }): string | undefined => /^\s+lightsout\s+(\S+)/.exec(line)?.[1];

/**
 * Every flag name the usage text shows for one command, unioned across its
 * lines: `lightsout refactor` and `lightsout refactor --run <id>` are two
 * shapes of the same command, and either shape's flags are accepted.
 *
 * The accepted set is read from the usage text rather than declared a second
 * time beside the dispatcher, because a second list drifts and both ways it can
 * drift are silent — a documented flag that is rejected, or an accepted flag
 * nobody documented. Read this way a flag works exactly when `usage` says it
 * does, so adding a flag to a command means documenting it.
 */
export const readCommandFlags = ({ command }: Params): Set<string> => {
	const lines = usage.split('\n').filter((line) => commandOf({ line }) === command);
	const names = lines.flatMap((line) => [...line.matchAll(/--([a-z][a-z\d-]*)/g)].map(([, name]) => name ?? ''));

	// --cwd is read by the dispatcher, before it knows which command it holds.
	return new Set(['cwd', ...names]);
};
