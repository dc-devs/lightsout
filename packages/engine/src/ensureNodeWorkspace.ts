import { rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { runCommand } from './runCommand';

const cloneTimeoutMs = 300_000;
const refreshAfterMs = 24 * 60 * 60 * 1000;

// Monorepo packages share one clone and their scans run in PARALLEL —
// concurrent callers for the same repo must share one clone operation, or
// they race ("could not create work tree dir: File exists").
const inFlight = new Map<string, Promise<string>>();

interface Params {
	/** Clone URL or local path from the node registry. */
	repo: string;
	/** Shared clone workspace (clones persist across runs; monorepo packages share their repo's clone). */
	workspaceDir: string;
	/** Refresh even when the clone is fresh — needed before path-scoped staleness checks. */
	forceRefresh?: boolean;
}

const ensure = async ({ repo, workspaceDir, forceRefresh, repoDir }: Params & { repoDir: string }) => {
	const existing = await stat(join(repoDir, '.git')).catch(() => undefined);

	if (!existing) {
		// A directory without .git is a dead partial clone — clear it first.
		await rm(repoDir, { recursive: true, force: true }).catch(() => undefined);

		const clone = await runCommand({ command: `git clone --depth 1 '${repo}' '${repoDir}'`, cwd: workspaceDir, timeoutMs: cloneTimeoutMs });

		if (clone.exitCode !== 0) {
			throw new Error(`clone failed for ${repo}: ${`${clone.stdout}\n${clone.stderr}`.trim().slice(0, 300)}`);
		}

		return repoDir;
	}

	if (forceRefresh || Date.now() - existing.mtimeMs > refreshAfterMs) {
		await runCommand({ command: 'git fetch --depth 1 origin && git reset --hard FETCH_HEAD', cwd: repoDir, timeoutMs: cloneTimeoutMs }).catch(() => undefined);
	}

	return repoDir;
};

/**
 * Shallow-clone the node's repo into the shared workspace (or refresh a
 * clone older than a day). Returns the local repo directory — anchors are
 * repo-root-relative, so this is the path hop agents work in. Concurrent
 * calls for the same target share one operation. A refresh failure degrades
 * to the stale clone (offline-friendly); a clone failure is a hard error,
 * because a hop without code has nothing to trace.
 */
export const ensureNodeWorkspace = async ({ repo, workspaceDir, forceRefresh = false }: Params) => {
	const dirName = basename(repo, '.git').replace(/[^A-Za-z0-9._-]/g, '-') || 'repo';
	const repoDir = join(workspaceDir, dirName);
	const running = inFlight.get(repoDir);

	if (running) {
		return running;
	}

	const operation = ensure({ repo, workspaceDir, forceRefresh, repoDir }).finally(() => inFlight.delete(repoDir));

	inFlight.set(repoDir, operation);

	return operation;
};
