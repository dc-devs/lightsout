import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, matchesGlob } from 'node:path';
import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { planningPathIdentity } from '#src/plan/workflow/common/evidence/planningPathIdentity.ts';

interface Params {
	cwd: string;
	path: string;
	exclude?: string[];
}

/** Observe direct membership with path identity checks and a stable predicate fingerprint. */
export const readPlanningDirectory = async ({ cwd, path, exclude = [] }: Params): Promise<{ entries: Dirent[]; fingerprint: string } | undefined> => {
	const before = await planningPathIdentity({ cwd, path });
	if (!before.exists) return undefined;
	const observed = await readdir(join(before.root, path), { withFileTypes: true });
	const entries = observed.filter((entry) => !exclude.some((pattern) => matchesGlob(path === '.' ? entry.name : `${path}/${entry.name}`, pattern)));
	const after = await planningPathIdentity({ cwd, path });
	if (before.identity !== after.identity) throw new Error(`Planning directory changed during acquisition: ${path}`);
	const members = entries
		.map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other' }))
		.sort((a, b) => a.name.localeCompare(b.name));
	return { entries, fingerprint: sha256({ content: canonicalJson({ value: members }) }) };
};
