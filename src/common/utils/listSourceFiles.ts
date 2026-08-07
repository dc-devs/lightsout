import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const skippedDirs = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);
const sourceExtension = /\.(m|c)?[jt]sx?$/;

interface Params {
	cwd: string;
	/** Repo-relative path prefixes to exclude (the config's `generated` list). */
	exclude?: string[];
}

/**
 * All JS/TS source files under cwd, repo-relative, skipping dot/dependency/
 * build dirs, declaration files, and the consumer's declared generated
 * paths. Test files ARE included — callers that must ignore them
 * (duplication tiers, per the contract-pinning doctrine) filter with
 * `isTestFile`.
 */
export const listSourceFiles = async ({ cwd, exclude = [] }: Params) => {
	const files: string[] = [];

	const walk = async (dir: string) => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

		for (const entry of entries) {
			if (entry.name.startsWith('.') || skippedDirs.has(entry.name)) {
				continue;
			}

			const path = join(dir, entry.name);

			if (entry.isDirectory()) {
				await walk(path);
				continue;
			}

			const rel = relative(cwd, path);

			if (!sourceExtension.test(entry.name) || entry.name.endsWith('.d.ts')) {
				continue;
			}

			if (exclude.some((prefix) => rel.startsWith(prefix.replace(/\/$/, '')))) {
				continue;
			}

			files.push(rel);
		}
	};

	await walk(cwd);

	return files.sort();
};
