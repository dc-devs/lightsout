interface Params {
	source: string;
}

/**
 * A connections source is a local directory OR a git repo (optionally with
 * a folder inside it) — the central-map-first posture (T3) means the common
 * case is `git@github.com:org/data-flow-map` or a folder within a shared
 * repo. Subpath forms, in precedence order: an explicit `.git/` delimiter
 * (`…/map.git/src/connections`), a `//` separator (`…/repo//src/conn`),
 * and the bare heuristic — the first two path segments after the host are
 * the repo, the rest the folder (`git@host:org/repo/src/connections`).
 */
export const parseConnectionsSource = ({ source }: Params) => {
	const looksGit = /^(git@|ssh:\/\/|https?:\/\/)/.test(source) || /\.git(\/|$)/.test(source);

	if (!looksGit) {
		return { kind: 'local' as const, path: source };
	}

	const dotGit = source.indexOf('.git/');

	if (dotGit !== -1) {
		return { kind: 'git' as const, repo: source.slice(0, dotGit + 4), subpath: source.slice(dotGit + 5) || undefined };
	}

	if (source.endsWith('.git')) {
		return { kind: 'git' as const, repo: source, subpath: undefined };
	}

	const protocolEnd = source.includes('://') ? source.indexOf('://') + 3 : 0;
	const doubleSlash = source.indexOf('//', protocolEnd);

	if (doubleSlash !== -1) {
		return { kind: 'git' as const, repo: source.slice(0, doubleSlash), subpath: source.slice(doubleSlash + 2) || undefined };
	}

	if (source.startsWith('git@')) {
		const colon = source.indexOf(':');
		const segments = source.slice(colon + 1).split('/');

		return {
			kind: 'git' as const,
			repo: `${source.slice(0, colon + 1)}${segments.slice(0, 2).join('/')}`,
			subpath: segments.slice(2).join('/') || undefined,
		};
	}

	// ssh:// and http(s):// — host + two segments = repo, the rest the folder.
	const segments = source.slice(protocolEnd).split('/');

	return {
		kind: 'git' as const,
		repo: `${source.slice(0, protocolEnd)}${segments.slice(0, 3).join('/')}`,
		subpath: segments.slice(3).join('/') || undefined,
	};
};
