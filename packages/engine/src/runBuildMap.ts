import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { EdgeInventory, MapJoin } from '@lightsout/contracts';
import { buildScanEdgesInvocation } from '@lightsout/agents';
import type { Driver } from '@lightsout/drivers';
import { ensureNodeWorkspace } from './ensureNodeWorkspace';
import { invokeAgentWithContract } from './invokeAgentWithContract';
import { joinInventories } from './joinInventories';
import { readConnectionMap } from './readConnectionMap';
import { readNodeRegistry } from './readNodeRegistry';
import { runCommand } from './runCommand';

const scanConcurrency = 5;
const defaultScanTimeoutMs = 30 * 60 * 1000;
const gitTimeoutMs = 60_000;

interface Params {
	cwd: string;
	driver: Driver;
	/** Node names to scan, or 'all' for every registry entry. */
	nodes: string[] | 'all';
	connectionsDir: string;
	/** Force fresh scans even when saved inventories are current. */
	rescan?: boolean;
	workspaceDir?: string;
	model?: string;
	permissionMode?: string;
	timeoutMs?: number;
	onProgress?: (message: string) => void;
}

/**
 * The map builder's scan + join (prototype decision T8): one scan-edges
 * agent per node in parallel, inventories saved durably (future runs
 * re-join against them without rescanning — staleness is SHA-gated, T9),
 * then the mechanical join over EVERY saved inventory. Ends at join.json —
 * the review-gate artifact; authoring is a separate, post-review step
 * (T14). Rate limits stop the run with all completed inventories saved, so
 * a re-run only scans what's missing.
 */
export const runBuildMap = async ({
	cwd,
	driver,
	nodes,
	connectionsDir,
	rescan = false,
	workspaceDir = join(homedir(), '.lightsout', 'traverse-repos'),
	model,
	permissionMode,
	timeoutMs = defaultScanTimeoutMs,
	onProgress,
}: Params) => {
	const progress = onProgress ?? (() => undefined);
	const mapDir = isAbsolute(connectionsDir) ? connectionsDir : join(cwd, connectionsDir);
	const registry = await readNodeRegistry({ connectionsDir: mapDir });
	const targets = nodes === 'all' ? [...registry.keys()] : nodes;

	for (const node of targets) {
		if (!registry.has(node)) {
			throw new Error(`node '${node}' is not in repos.yaml — register it first. Known nodes: ${[...registry.keys()].join(', ')}`);
		}
	}

	const inventoriesDir = join(cwd, '.lightsout', 'traverse', 'inventories');
	const runId = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
	const runDir = join(cwd, '.lightsout', 'traverse', 'map-runs', runId);

	await mkdir(inventoriesDir, { recursive: true });
	await mkdir(runDir, { recursive: true });
	await mkdir(workspaceDir, { recursive: true });

	const savedInventory = async (node: string) => {
		const raw = await readFile(join(inventoriesDir, `${node}.json`), 'utf8').catch(() => undefined);

		if (raw === undefined) {
			return undefined;
		}

		const parsed = EdgeInventory.safeParse(JSON.parse(raw));

		return parsed.success ? parsed.data : undefined;
	};

	// SHA-gated staleness (T9): whole-repo nodes need one ls-remote, no
	// clone; monorepo nodes are stale only when a commit touched their path.
	const isCurrent = async ({ node, saved }: { node: string; saved: EdgeInventory }) => {
		const source = registry.get(node);

		if (!source) {
			return false;
		}

		const remote = await runCommand({ command: `git ls-remote '${source.repo}' HEAD`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);
		const remoteSha = remote?.exitCode === 0 ? remote.stdout.trim().split(/\s/)[0] : undefined;

		if (remoteSha && remoteSha === saved.scannedSha) {
			return true;
		}

		if (source.path && saved.scannedPathSha) {
			const workspace = await ensureNodeWorkspace({ repo: source.repo, workspaceDir, forceRefresh: true });
			const pathSha = await runCommand({ command: `git log -1 --format=%H -- '${source.path}'`, cwd: workspace, timeoutMs: gitTimeoutMs }).catch(() => undefined);

			return pathSha?.exitCode === 0 && pathSha.stdout.trim() === saved.scannedPathSha;
		}

		return false;
	};

	const scanned: string[] = [];
	const reused: string[] = [];
	const failures: string[] = [];

	let rateLimited = false;

	const scanNode = async (node: string) => {
		if (!rescan) {
			const saved = await savedInventory(node);

			if (saved && (await isCurrent({ node, saved }))) {
				reused.push(node);
				progress(`scan ${node}: inventory current (sha-gated) — reused`);

				return;
			}
		}

		const source = registry.get(node);

		if (!source) {
			return;
		}

		const workspace = await ensureNodeWorkspace({ repo: source.repo, workspaceDir });

		progress(`scan ${node}: agent scanning ${workspace}${source.path ? ` (scope ${source.path})` : ''}`);

		const { report, failure, rateLimited: limited, usage } = await invokeAgentWithContract({
			driver,
			cwd: workspace,
			invocation: buildScanEdgesInvocation({ node, workspace, scope: source.path }),
			contract: EdgeInventory,
			model,
			permissionMode,
			timeoutMs,
			onRejectedOutput: async ({ text, attempt }) => {
				await writeFile(join(runDir, `scan-${node}-rejected-${attempt}.txt`), text, 'utf8').catch(() => undefined);
			},
		});

		if (usage) {
			progress(`scan ${node} usage: out ${usage.outputTokens} · $${usage.costUsd.toFixed(2)}`);
		}

		if (limited) {
			rateLimited = true;
			failures.push(`${node}: rate limited`);

			return;
		}

		if (!report) {
			failures.push(`${node}: ${failure}`);

			return;
		}

		await writeFile(join(inventoriesDir, `${node}.json`), `${JSON.stringify(report, undefined, '\t')}\n`, 'utf8');
		scanned.push(node);
		progress(`scan ${node}: ${report.edges.length} edge sighting(s), ${report.gaps.length} gap(s) — inventory saved`);
	};

	for (let index = 0; index < targets.length; index += scanConcurrency) {
		await Promise.all(targets.slice(index, index + scanConcurrency).map(scanNode));

		if (rateLimited) {
			break;
		}
	}

	if (failures.length > 0) {
		return {
			status: rateLimited ? ('paused-rate-limit' as const) : ('failed' as const),
			runId,
			runDir,
			join: undefined,
			scanned,
			reused,
			error: `${failures.join('; ')} — completed inventories are saved; re-run scans only what's missing`,
		};
	}

	// Pool EVERY saved inventory, not just this run's — incremental by design.
	const pooled: EdgeInventory[] = [];

	for (const name of (await readdir(inventoriesDir)).filter((entry) => entry.endsWith('.json'))) {
		const saved = await savedInventory(name.replace(/\.json$/, ''));

		if (saved) {
			pooled.push(saved);
		}
	}

	const edges = await readConnectionMap({ connectionsDir: mapDir }).catch(() => new Map());
	const joined = MapJoin.parse(joinInventories({ inventories: pooled, edges }));

	await writeFile(join(runDir, 'join.json'), `${JSON.stringify(joined, undefined, '\t')}\n`, 'utf8');
	progress(
		`join: ${joined.matched.length} new edge(s), ${joined.confirmed.length} confirmed, ${joined.drifted.length} drifted, ${joined.orphansOut.length}/${joined.orphansIn.length} orphan(s) out/in, ${joined.noise.length} noise`,
	);

	return { status: 'complete' as const, runId, runDir, join: joined, scanned, reused, error: undefined };
};
