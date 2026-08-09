import { getBaseName } from './getBaseName.ts';

interface Params {
	/** A repo-relative path. */
	path: string;
}

/**
 * The export name a file's path implies — its base name with the extension
 * stripped.
 *
 * One export per file makes the filename the symbol, so every rule that
 * compares a file against what it declares starts from the same derivation: the
 * same name declared in two places, a name that does not match the export
 * inside, a file holding a second export its name cannot cover.
 */
export const getExportName = ({ path }: Params): string => getBaseName({ path }).replace(/\.(m|c)?[jt]sx?$/, '');
