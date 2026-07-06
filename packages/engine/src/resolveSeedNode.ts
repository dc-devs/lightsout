import { realpathSync } from 'node:fs';
import { basename, isAbsolute, relative } from 'node:path';
import type { ConnectionDoc } from '@lightsout/contracts';
import { runCommand } from './common/utils/runCommand';

/** Resolve symlinks so a repos.yaml path and `git rev-parse` (which reports the realpath, e.g. /private/var vs /var) compare equal; a non-path (git URL) or missing dir falls through unchanged. */
const realOf = (value: string) => {
	try {
		return realpathSync(value);
	} catch {
		return value;
	}
};

/** Normalize a repo reference so ssh/https/`.git` forms of the same remote compare equal (`git@github.com:o/r.git` ≡ `https://github.com/o/r`). */
const normalizeRepo = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/^(git\+)?(ssh|https?):\/\//, '')
		.replace(/^git@/, '')
		.replace(/:/g, '/')
		.replace(/\.git$/, '')
		.replace(/\/+$/, '');

/** Seed workspace: the dev's local working tree (CWD-seeded — catches uncommitted code) or a full-history clone (`--start`-seeded, incl. remote/CI). */
type SeedWorkspace = { kind: 'local'; path: string } | { kind: 'clone'; repo: string; scope?: string };

interface Params {
	cwd: string;
	registry: Map<string, { repo: string; path?: string }>;
	edges: Map<string, ConnectionDoc>;
	/** Explicit --start node name; when absent, infer the seed from the CWD. */
	start?: string;
}

/**
 * Resolve the debug seed: which node the investigation starts in, and where
 * its code lives. `--start` wins (clone it, full history — works anywhere,
 * incl. a remote box). Otherwise infer from the CWD by matching its git
 * remote (or repo root) + monorepo subpath against repos.yaml, and read the
 * dev's LOCAL working tree so uncommitted/branch changes are in scope. The
 * seed-scoped preflight lives here: registered + resolvable is a hard error;
 * "no mapped edges" (cross-repo hops impossible) is advisory. Ambiguity (the
 * monorepo root, or several matches) errors and asks for --start rather than
 * guessing.
 */
export const resolveSeedNode = async ({ cwd, registry, edges, start }: Params) => {
	const hasEdges = (node: string) => [...edges.values()].some((doc) => doc.from === node || doc.to === node);
	const advisory = (node: string) => (hasEdges(node) ? [] : [`'${node}' has no mapped edges — local-only debug (no cross-repo hops); register + build-map to enable them`]);

	if (start) {
		const source = registry.get(start);

		if (!source) {
			throw new Error(`--start '${start}' is not a registered node. Known: ${[...registry.keys()].join(', ') || 'none'}`);
		}

		return {
			node: start,
			workspace: { kind: 'clone', repo: source.repo, scope: source.path } as SeedWorkspace,
			registered: true,
			notes: [`seed: ${start} (--start) — full-history clone`, ...advisory(start)],
		};
	}

	const root = (await runCommand({ command: 'git rev-parse --show-toplevel', cwd }).catch(() => undefined))?.stdout.trim() ?? '';
	const remote = (await runCommand({ command: 'git remote get-url origin', cwd }).catch(() => undefined))?.stdout.trim() ?? '';
	const subpath = root ? relative(root, cwd) : '';

	const withinPath = (path?: string) => {
		if (!path) {
			return true; // whole-repo node — any location in the repo counts
		}

		const rel = relative(path, subpath || '.');

		return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
	};

	const remoteKey = remote ? normalizeRepo(remote) : '';
	const rootKey = root ? normalizeRepo(realOf(root)) : '';

	const repoNodes = [...registry.entries()].filter(([, source]) => {
		const byRemote = remoteKey !== '' && normalizeRepo(source.repo) === remoteKey;
		const byRoot = rootKey !== '' && normalizeRepo(realOf(source.repo)) === rootKey;

		return byRemote || byRoot;
	});

	if (repoNodes.length === 0) {
		const node = basename(root || cwd) || 'local';

		return {
			node,
			workspace: { kind: 'local', path: cwd } as SeedWorkspace,
			registered: false,
			notes: [`CWD repo is not in the map — local-only debug as '${node}' (no cross-repo hops; register it + build-map to enable them)`],
		};
	}

	const pathMatches = repoNodes.filter(([, source]) => withinPath(source.path));

	if (pathMatches.length === 0) {
		throw new Error(`CWD is in the repo but not inside a registered package — pass --start to pick a node: ${repoNodes.map(([node]) => node).join(', ')}`);
	}

	if (pathMatches.length > 1) {
		throw new Error(`CWD matches multiple nodes (${pathMatches.map(([node]) => node).join(', ')}) — pass --start to pick one`);
	}

	const node = pathMatches[0]![0];

	return {
		node,
		workspace: { kind: 'local', path: cwd } as SeedWorkspace,
		registered: true,
		notes: [`seed: inferred node ${node} from CWD — local working tree`, ...advisory(node)],
	};
};
