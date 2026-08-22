import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';

interface Params {
	flags: Map<string, string | true>;
	name: string;
}

/**
 * Read a comma-separated list flag — `--packages a,b`, `--phase 1,3`.
 *
 * Three states, deliberately distinct: the flag absent is `undefined`, the flag
 * present but naming nothing (`--phase ,`) is `[]`, and anything else is its
 * trimmed non-empty parts. The empty list is not collapsed into `undefined`
 * here, because a caller that must refuse an empty request can only tell the two
 * apart if the flag's presence survives the read; a caller that does not care
 * collapses it itself.
 *
 * Comma-separated rather than repeated: `parseFlags` returns
 * `Map<string, string | true>`, so a second `--phase 3` would silently overwrite
 * the first.
 */
export const getListFlag = ({ flags, name }: Params): string[] | undefined => {
	if (!flags.has(name)) {
		return undefined;
	}

	return (getStringFlag({ flags, name }) ?? '')
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
};
