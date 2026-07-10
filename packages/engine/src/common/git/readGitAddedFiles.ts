import { readGitPrefix } from './readGitPrefix';
import { runCommand } from '../utils/runCommand';

const gitTimeoutMs = 60_000;

interface Params {
	cwd: string;
	/** When set, also count files added since this ref (git diff --name-status). */
	base?: string;
}

/**
 * The subset of changed files that are NEW (untracked/added), cwd-relative and
 * .lightsout/-filtered. Feeds selectMissingTests' new-vs-modified routing
 * (decision 23). Returns [] outside a worktree rather than throwing — the
 * changed-file basis helpers guard that case, and a new-file miss only softens
 * a red to an advisory, never invents one.
 */
export const readGitAddedFiles = async ({ cwd, base }: Params): Promise<string[]> => {
	const prefix = await readGitPrefix({ cwd });

	if (prefix === undefined) {
		return [];
	}

	const added: string[] = [];

	// Untracked (`??`) and freshly-added (index status `A`, covering `A `, `AM`,
	// `AD`) working-tree files — the new files not yet a tracked baseline.
	const status = await runCommand({ command: 'git status --porcelain=v1 -uall -- .', cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

	if (status && status.exitCode === 0) {
		for (const line of status.stdout.split('\n').filter(Boolean)) {
			const code = line.slice(0, 2);

			if (code === '??' || code[0] === 'A') {
				const path = line.slice(3);
				const renameTarget = path.split(' -> ').at(-1) ?? path;

				added.push(renameTarget.replace(/^"|"$/g, ''));
			}
		}
	}

	// Mirrors the changed-file union (Converge decision 17): files added since
	// the base ref are new too, from the committed side of --base <ref>.
	if (base !== undefined) {
		const diff = await runCommand({ command: `git diff --name-status ${base} -- .`, cwd, timeoutMs: gitTimeoutMs }).catch(() => undefined);

		if (diff && diff.exitCode === 0) {
			for (const line of diff.stdout.split('\n').filter(Boolean)) {
				const [changeStatus, ...rest] = line.split('\t');
				const path = rest.at(-1);

				if (changeStatus.startsWith('A') && path) {
					added.push(path);
				}
			}
		}
	}

	return [
		...new Set(
			added
				.map((path) => (prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path))
				.filter((path) => !path.startsWith('.lightsout/')),
		),
	];
};
