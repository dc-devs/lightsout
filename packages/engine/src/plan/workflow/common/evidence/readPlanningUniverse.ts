import { lstat, readdir, readlink } from 'node:fs/promises';
import { join, matchesGlob } from 'node:path';
import { sha256 } from '#src/common/utils/sha256.ts';
import { planningPathIdentity } from '#src/plan/workflow/common/evidence/planningPathIdentity.ts';
import { readPlanningBytes } from '#src/plan/workflow/common/evidence/readPlanningBytes.ts';
import type { PlanningUniverse } from '#src/plan/workflow/common/types/PlanningUniverse.ts';

interface Params {
	cwd: string;
	roots: string[];
	exclude: string[];
	glob?: string;
	contents?: boolean;
	hashFiles?: boolean;
}

/** Inventory the complete declared namespace, retaining negative inputs and explicit unobserved reach. */
export const readPlanningUniverse = async ({ cwd, roots, exclude, glob = '**/*', contents = false, hashFiles = true }: Params): Promise<PlanningUniverse> => {
	const files: PlanningUniverse['files'] = [];
	const members: PlanningUniverse['members'] = [];
	const seen = new Set<string>();
	let unknown = false;
	const ignored = ({ path }: { path: string }) => exclude.some((pattern) => matchesGlob(path, pattern));
	const walk = async ({ path, discovered = false }: { path: string; discovered?: boolean }): Promise<void> => {
		if (seen.has(path) || ignored({ path })) return;
		seen.add(path);
		const before = await planningPathIdentity({ cwd, path, allowFinalLink: true });
		if (!before.exists) {
			if (discovered) throw new Error(`Planning search member disappeared: ${path}`);
			members.push({ path, kind: 'missing' });
			return;
		}
		const target = join(before.root, path);
		const status = await lstat(target);
		if (status.isSymbolicLink()) {
			members.push({ path, kind: 'symlink', target: await readlink(target) });
			unknown = true;
		} else if (status.isDirectory()) {
			members.push({ path, kind: 'directory' });
			const entries = (await readdir(target)).sort();
			for (const entry of entries) await walk({ path: path === '.' ? entry : `${path}/${entry}`, discovered: true });
			const afterEntries = (await readdir(target)).sort();
			if (JSON.stringify(entries) !== JSON.stringify(afterEntries)) throw new Error(`Planning search directory changed: ${path}`);
		} else if (!status.isFile()) {
			members.push({ path, kind: 'other' });
			unknown = true;
		} else {
			members.push({ path, kind: 'file' });
			if (hashFiles && matchesGlob(path, glob)) {
				const bytes = await readPlanningBytes({ cwd, path });
				if (bytes === undefined) throw new Error(`Planning search file disappeared: ${path}`);
				const text = bytes.toString('utf8');
				files.push({ path, sha256: sha256({ content: bytes }), ...(contents && Buffer.from(text, 'utf8').equals(bytes) ? { content: text } : {}) });
			}
		}
		const after = await planningPathIdentity({ cwd, path, allowFinalLink: true });
		if (before.identity !== after.identity || !after.exists) throw new Error(`Planning search path changed: ${path}`);
	};
	for (const path of [...new Set(roots)].sort()) await walk({ path });
	files.sort((a, b) => a.path.localeCompare(b.path));
	members.sort((a, b) => a.path.localeCompare(b.path));
	return { files, members, unknown };
};
