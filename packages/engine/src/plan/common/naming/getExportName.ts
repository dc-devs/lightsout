import { basename } from 'node:path';

interface Params {
	/** A repo-relative path, or a bare filename. */
	path: string;
}

/**
 * A path or filename reduced to its export name — the extension stripped.
 * One-export-per-file makes the filename the symbol, so this is the symbol name.
 *
 * A copy of the default standards package's `getExportName`, which must AGREE
 * with this but cannot be identical: a check derives the base name itself
 * rather than reaching for `node:path`. `scripts/checkMirrors.mjs` compares
 * code, so it cannot hold these two together — only a reader can.
 */
export const getExportName = ({ path }: Params): string => basename(path).replace(/\.(m|c)?[jt]sx?$/, '');
