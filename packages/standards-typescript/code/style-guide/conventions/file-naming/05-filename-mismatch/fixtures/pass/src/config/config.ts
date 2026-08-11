// Two exports, so the file has no single export for its name to match — the
// one-export-per-file rule owns this file.
export interface Config {
	name: string;
}

export const defaultConfig: Config = { name: 'default' };
