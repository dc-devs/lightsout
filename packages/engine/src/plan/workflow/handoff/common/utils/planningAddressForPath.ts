import { lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { PlanningPath } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	planPath: string;
}

/** Canonical implementation inputs live under the managed workspace; external legacy files retain their existing semantics. */
export const planningAddressForPath = async ({ cwd, planPath }: Params): Promise<{ name: string; file: string } | undefined> => {
	const full = resolve(cwd, planPath);
	const root = resolve(cwd, '.lightsout/plans');
	const local = relative(root, full);
	if (local.startsWith('../') || local === '..' || resolve(root, local) !== full) {
		for (const marker of ['.planning', 'planning-record.json', 'planning-views.json', 'planning-standards.json']) {
			try {
				await lstat(join(dirname(full), marker));
			} catch (error) {
				if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') continue;
				throw error;
			}
			throw new Error('Restore this new-format plan into its managed .lightsout/plans workspace before implementation');
		}
		return undefined;
	}
	const name = dirname(local);
	if (name === '.') return undefined;
	PlanningPath.parse(name);
	return { name, file: relative(join(root, name), full) };
};
