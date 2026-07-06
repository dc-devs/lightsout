import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

const registry = z.record(
	z.string(),
	z.union([
		z.string(),
		z.object({
			repo: z.string(),
			/** Monorepo package subpath — packages sharing a repo share one clone (prototype decision T4). */
			path: z.string(),
		}),
	]),
);

interface Params {
	connectionsDir: string;
}

/**
 * repos.yaml: node name → where its code lives. A node is a traversal unit —
 * a whole repo or one monorepo package; the repo is a storage detail (T4).
 * A node absent from the registry is a non-repo node (AWS service, external
 * system) that traversal crosses mechanically.
 */
export const readNodeRegistry = async ({ connectionsDir }: Params) => {
	const path = join(connectionsDir, 'repos.yaml');
	const raw = await readFile(path, 'utf8').catch(() => {
		throw new Error(`node registry not found: ${path}`);
	});
	const parsed = registry.safeParse(parse(raw));

	if (!parsed.success) {
		throw new Error(`repos.yaml failed its contract: ${parsed.error.message}`);
	}

	return new Map(
		Object.entries(parsed.data).map(([node, source]) => [
			node,
			typeof source === 'string' ? { repo: source, path: undefined } : { repo: source.repo, path: source.path },
		]),
	);
};
