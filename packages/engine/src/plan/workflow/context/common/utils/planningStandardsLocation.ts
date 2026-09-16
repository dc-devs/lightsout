import { isAbsolute, relative } from 'node:path';

interface Params {
	cwd: string;
	roots: string[];
	path: string;
}

/** Stable provenance within the checkout or an ordered declared pack, independent of a machine's checkout/cache prefix. */
export const planningStandardsLocation = ({ cwd, roots, path }: Params): string => {
	const locations = [{ root: cwd, identity: 'workspace' }, ...roots.map((root, index) => ({ root, identity: `standards-pack:${index}` }))];
	for (const { root, identity } of locations) {
		const local = relative(root, path);
		if (!isAbsolute(local) && local !== '..' && !local.startsWith('../')) return `${identity}/${local || '.'}`;
	}
	throw new Error(`Standards provenance is outside declared roots: ${path}`);
};
