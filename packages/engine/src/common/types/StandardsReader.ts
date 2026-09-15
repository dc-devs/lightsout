import type { Dirent } from 'node:fs';

/** Optional observed IO for consumers that must bind standards to the exact inputs used by existing parsers. */
export interface StandardsReader {
	text(params: { path: string }): Promise<string | undefined>;
	list(params: { path: string; optional?: boolean }): Promise<Dirent[]>;
	exists(params: { path: string }): Promise<boolean>;
}
