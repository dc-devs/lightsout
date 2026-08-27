import { getCommandCatalogEntry } from '#src/commands/index.ts';

interface Params {
	command: string;
}

/**
 * Every flag name a command accepts, unioned across its invocation shapes:
 * `lightsout refactor` and `lightsout refactor --run <id>` are two shapes of
 * the same command, and either shape's flags are accepted.
 *
 * The accepted set is read from the command catalog rather than declared a
 * second time beside the dispatcher, because a second list drifts and both ways
 * it can drift are silent — a documented flag that is rejected, or an accepted
 * flag nobody documented. The catalog is also what the usage text renders from,
 * so a flag works exactly when `--help` says it does, and adding a flag to a
 * command means documenting it.
 *
 * A flag carrying a different placeholder in two shapes is two catalog rows
 * with one name; the Set folds them back into one accepted flag.
 */
export const readCommandFlags = ({ command }: Params): Set<string> => {
	const entry = getCommandCatalogEntry({ id: command });

	// --cwd is read by the dispatcher, before it knows which command it holds.
	return new Set(['cwd', ...(entry?.flags.map((flag) => flag.name) ?? [])]);
};
