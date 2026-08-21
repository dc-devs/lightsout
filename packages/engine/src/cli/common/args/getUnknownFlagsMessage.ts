import { readCommandFlags } from '#src/cli/common/args/readCommandFlags.ts';

interface Params {
	command: string;
	flags: Map<string, string | true>;
}

/**
 * How the passed flags fail the command, or undefined when they all belong to
 * it.
 *
 * A misspelt flag used to be silently ignored: `standards-check --code-check`
 * ran the whole check, agent review included, and exited 0, so the run looked
 * like the one that was asked for. A flag a command does not accept is a usage
 * error, answered the way every other usage error here is — this message and
 * the usage text on stderr, exit 1.
 */
export const getUnknownFlagsMessage = ({ command, flags }: Params): string | undefined => {
	const accepted = readCommandFlags({ command });
	const unknown = [...flags.keys()].filter((name) => !accepted.has(name));

	return unknown.length === 0
		? undefined
		: `lightsout ${command}: unknown flag${unknown.length > 1 ? 's' : ''} ${unknown.map((name) => `--${name}`).join(', ')}`;
};
