import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { ensureNodeWorkspace } from './ensureNodeWorkspace';
import { patchConnectionDoc } from './patchConnectionDoc';
import { readConnectionMap } from './readConnectionMap';
import { readNodeRegistry } from './readNodeRegistry';
import { runCommand } from '../common/utils/runCommand';

const gitTimeoutMs = 60_000;

interface AnchorResult {
	doc: string;
	side: 'from' | 'to';
	node: string;
	/** current = SHA unchanged since last verification, nothing re-checked (T9); ok = pattern found at the anchored path; drifted = found elsewhere; missing = not in the repo at all. */
	status: 'current' | 'ok' | 'drifted' | 'missing' | 'unverifiable';
	foundAt?: string;
	detail?: string;
}

interface Params {
	cwd: string;
	connectionsDir: string;
	/** Restrict to these doc ids (default: the whole map). */
	docIds?: string[];
	/** Apply what verification found: advance last-verified-sha on ok, repoint drifted anchors. Missing is only ever reported. */
	repair?: boolean;
	workspaceDir?: string;
	onProgress?: (message: string) => void;
}

/**
 * The map's freshness sweep as pure code — no agent anywhere (prototype
 * decisions T2/T9): cost is O(edges in the map), not O(repos in the org).
 * Per anchor: skip when the node's HEAD hasn't moved since last
 * verification (one ls-remote, no clone); otherwise grep the pattern at the
 * anchored path, then repo-wide. `repair` applies the mechanical fixes;
 * missing anchors are reported for a human — never silently deleted.
 */
export const verifyConnectionAnchors = async ({
	cwd,
	connectionsDir,
	docIds,
	repair = false,
	workspaceDir = join(homedir(), '.lightsout', 'traverse-repos'),
	onProgress,
}: Params) => {
	const progress = onProgress ?? (() => undefined);
	const mapDir = isAbsolute(connectionsDir) ? connectionsDir : join(cwd, connectionsDir);
	const edges = await readConnectionMap({ connectionsDir: mapDir });
	const registry = await readNodeRegistry({ connectionsDir: mapDir });
	const targets = docIds ?? [...edges.keys()];
	const results: AnchorResult[] = [];
	const headByRepo = new Map<string, string | undefined>();

	const remoteHead = async (repo: string) => {
		if (!headByRepo.has(repo)) {
			const result = await runCommand({ command: `git ls-remote '${repo}' HEAD`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

			headByRepo.set(repo, result?.exitCode === 0 ? result.stdout.trim().split(/\s/)[0] : undefined);
		}

		return headByRepo.get(repo);
	};

	for (const id of targets) {
		const doc = edges.get(id);

		if (!doc) {
			results.push({ doc: id, side: 'from', node: 'unknown', status: 'unverifiable', detail: `no doc named '${id}' in the map` });
			continue;
		}

		for (const side of ['from', 'to'] as const) {
			const anchor = side === 'from' ? doc.fromAnchor : doc.toAnchor;
			const node = side === 'from' ? doc.from : doc.to;

			if (!anchor) {
				continue;
			}

			const source = registry.get(node);

			if (!source) {
				results.push({ doc: id, side, node, status: 'unverifiable', detail: 'non-repo node' });
				continue;
			}

			const head = await remoteHead(source.repo);

			if (head && doc.lastVerifiedSha?.[node] === head) {
				results.push({ doc: id, side, node, status: 'current' });
				continue;
			}

			const workspace = await ensureNodeWorkspace({ repo: source.repo, workspaceDir, forceRefresh: true });
			const fileText = await readFile(join(workspace, anchor.path), 'utf8').catch(() => undefined);

			if (fileText?.includes(anchor.pattern)) {
				results.push({ doc: id, side, node, status: 'ok' });

				if (repair && head) {
					await patchConnectionDoc({
						path: join(mapDir, `${id}.md`),
						patch: (raw) => {
							raw['last-verified-sha'] = { ...(raw['last-verified-sha'] as Record<string, unknown> | undefined), [node]: head };
						},
					});
				}

				continue;
			}

			// Not at the anchored path — is the pattern anywhere in the repo?
			const search = await runCommand({
				command: `grep -rn --fixed-strings ${JSON.stringify(anchor.pattern)} . --exclude-dir=.git | head -1`,
				cwd: workspace,
				timeoutMs: gitTimeoutMs,
			}).catch(() => undefined);
			const hit = search?.exitCode === 0 ? search.stdout.trim() : '';
			const foundAt = hit ? hit.replace(/^\.\//, '').split(':').slice(0, 2).join(':') : undefined;

			if (foundAt) {
				results.push({ doc: id, side, node, status: 'drifted', foundAt });

				if (repair) {
					await patchConnectionDoc({
						path: join(mapDir, `${id}.md`),
						patch: (raw) => {
							raw[`${side}-anchor`] = { path: foundAt.split(':')[0], pattern: anchor.pattern };
							raw['last-verified-sha'] = { ...(raw['last-verified-sha'] as Record<string, unknown> | undefined), [node]: head ?? null };
						},
					});
				}
			} else {
				results.push({ doc: id, side, node, status: 'missing', detail: 'pattern not found anywhere in the repo — endpoint renamed or removed; a human decides (never auto-deleted)' });
			}
		}

		progress(`verify ${id}: ${results.filter((entry) => entry.doc === id).map((entry) => `${entry.side} ${entry.status}`).join(', ')}`);
	}

	return results;
};
