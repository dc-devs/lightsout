import type { Stats } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { PlanningPath } from '#src/contracts/index.ts';

interface Params {
	cwd: string;
	path: string;
	allowFinalLink?: boolean;
}

/** Snapshot every ancestor without following links; even a missing descendant must have safe ancestors. */
export const planningPathIdentity = async ({
	cwd,
	path,
	allowFinalLink = false,
}: Params): Promise<{ root: string; exists: boolean; identity: string; regularFile: boolean }> => {
	PlanningPath.parse(path);
	const root = await realpath(cwd);
	const parts = path === '.' ? [] : path.split('/');
	const identities: string[] = [];
	let regularFile = false;
	for (let index = 0; index <= parts.length; index++) {
		const target = join(root, ...parts.slice(0, index));
		let status: Stats;
		try {
			status = await lstat(target);
		} catch (error) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
				return { root, exists: false, identity: identities.join('|'), regularFile: false };
			throw error;
		}
		if (status.isSymbolicLink() && !(allowFinalLink && index === parts.length)) throw new Error(`Planning evidence path contains a symbolic link: ${path}`);
		if (index < parts.length && !status.isDirectory()) throw new Error(`Planning evidence ancestor is not a directory: ${path}`);
		regularFile = status.isFile();
		identities.push(`${target}:${status.dev}:${status.ino}:${status.mode}`);
	}
	return { root, exists: true, identity: identities.join('|'), regularFile };
};
