import type { RenameRule } from '#src/contracts/plan/renames/RenameRule.ts';

interface Params {
	text: string;
	renames: RenameRule[];
}

/**
 * The text with every rename applied in declared order: each a literal,
 * case-sensitive replacement of every occurrence of `from`.
 *
 * One rule for paths, import specifiers and symbols alike, and deliberately no
 * regular expression: a plan must not be able to declare a rename too loose to
 * prove anything.
 */
export const applyRenames = ({ text, renames }: Params): string => renames.reduce((renamed, { from, to }) => renamed.replaceAll(from, to), text);
