import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

interface Params {
	/** Repo-relative paths to write, each a one-export module the prior-art detector can find. */
	existing: string[];
}

/** A temp repo holding the given existing source files, each a one-export module. */
export const seedSourceRepo = ({ existing }: Params): string => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-dedup-run-'));

	for (const rel of existing) {
		const abs = join(cwd, rel);

		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, 'export const x = 1;\n');
	}

	return cwd;
};
