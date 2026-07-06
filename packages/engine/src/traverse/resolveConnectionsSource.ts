import { isAbsolute, join } from 'node:path';
import { defaultWorkspaceDir } from './common/constants/defaultWorkspaceDir';
import { ensureNodeWorkspace } from './ensureNodeWorkspace';
import { parseConnectionsSource } from './parseConnectionsSource';

interface Params {
	cwd: string;
	/** Local dir, git URL, or git URL + folder (see parseConnectionsSource). */
	source: string;
	workspaceDir?: string;
}

/**
 * Resolve a connections source to a local directory. A git source is
 * cloned/refreshed into the shared workspace (always refreshed — the map
 * moves often and a stale map misroutes traversals), so every machine
 * traverses against the central map's current HEAD without anyone cloning
 * by hand. Writes (author, repair, drafts) land in that clone — the caller
 * announces where, so the user commits/PRs from there.
 */
export const resolveConnectionsSource = async ({ cwd, source, workspaceDir = defaultWorkspaceDir }: Params) => {
	const parsed = parseConnectionsSource({ source });

	if (parsed.kind === 'local') {
		return { dir: isAbsolute(parsed.path) ? parsed.path : join(cwd, parsed.path), remote: false, repo: undefined };
	}

	const repoDir = await ensureNodeWorkspace({ repo: parsed.repo, workspaceDir, forceRefresh: true });

	return { dir: parsed.subpath ? join(repoDir, parsed.subpath) : repoDir, remote: true, repo: parsed.repo };
};
