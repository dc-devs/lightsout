import { basename } from 'node:path';

/**
 * A path or filename reduced to its export name — the extension stripped.
 * One-export-per-file makes the filename the symbol, so this is the symbol name.
 */
export const nameOf = (path: string): string => basename(path).replace(/\.(m|c)?[jt]sx?$/, '');
