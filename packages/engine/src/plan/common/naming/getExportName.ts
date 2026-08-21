import { basename } from 'node:path';

interface Params {
	/** A repo-relative path, or a bare filename. */
	path: string;
}

/**
 * A path or filename reduced to its export name — the extension stripped.
 * One-export-per-file makes the filename the symbol, so this is the symbol name.
 */
export const getExportName = ({ path }: Params): string => basename(path).replace(/\.(m|c)?[jt]sx?$/, '');
