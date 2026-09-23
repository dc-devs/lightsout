import { execSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedWorkOrderRecord } from '#tests/helpers/seedWorkOrderRecord.ts';

interface Params {
	/** A feature branch to create and stand on, with one commit of its own. Omit to stay on the default branch. */
	branch?: string;
	/** Files to leave uncommitted, by repo-relative name — what a dirty tree looks like. */
	dirty?: Record<string, string>;
	/** Whether `origin/HEAD` is set — a repo that never had it set is how "no default branch" is arranged. */
	remoteHead?: boolean;
	/**
	 * Whether the branch gets the work order that claims it.
	 *
	 * On by default, because every machine-local record a run files — its branch
	 * phase, its ship result, its worktree ownership — is filed in the work order
	 * whose record stores the branch. A case about a branch nobody authored turns
	 * it off.
	 */
	workOrder?: boolean;
}

/**
 * A repo with a real `origin` behind it: a bare remote, a `main` pushed to it,
 * `origin/HEAD` set, and optionally a feature branch standing on top.
 *
 * Ship reads and writes real git — the branch it is on, the remote's default
 * branch, the push, the local cleanup — so the arrangement is a real worktree
 * rather than a stubbed `git`. The forge is the only thing stubbed, because it
 * is the only thing that would leave the machine.
 */
export const setupBranchRepo = ({ branch, dirty, remoteHead = true, workOrder = true }: Params = {}) => {
	const origin = mkdtempSync(join(tmpdir(), 'lightsout-origin-'));
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-branch-'));
	const author = '-c user.name=t -c user.email=t@t';
	const git = (command: string) => execSync(command, { cwd, stdio: 'ignore' });

	execSync('git init -q --bare -b main .', { cwd: origin, stdio: 'ignore' });
	execSync('git init -q -b main && git config user.name t && git config user.email t@t .', { cwd, stdio: 'ignore' });
	// The run's own state folder is excluded through git's per-repository list
	// rather than a committed `.gitignore`, so the work order record below is
	// invisible to every `git status`, `git add -A` and `git clean -fd` a subject
	// runs — and to every case that states what this repo's commits contain.
	appendFileSync(join(cwd, '.git', 'info', 'exclude'), '.lightsout/\n');
	// A repo-level identity, because the subject under test may commit plainly —
	// a CI runner has no global one, and only the fixture knows that.
	git('git config user.name t && git config user.email t@t');
	writeFileSync(join(cwd, 'README.md'), '# repo\n');
	git('git add -A');
	git(`git ${author} commit -qm init`);
	git(`git remote add origin ${origin}`);
	git('git push -q -u origin main');

	if (remoteHead) {
		git('git remote set-head origin -a');
	}

	if (branch !== undefined) {
		git(`git checkout -q -b ${branch}`);
		writeFileSync(join(cwd, 'feature.md'), '# feature\n');
		git('git add -A');
		git(`git ${author} commit -qm "add the feature"`);
	}

	// A branch carrying a slash is a prefixed one, whose label is never the
	// branch — the case that arranges one writes its own record.
	if (branch !== undefined && workOrder && !branch.includes('/')) {
		seedWorkOrderRecord({ cwd, name: branch, ticketRef: /^[a-z]+-\d+/iu.exec(branch)?.[0] });
	}

	for (const [path, content] of Object.entries(dirty ?? {})) {
		writeFileSync(join(cwd, path), content);
	}

	return { cwd, origin };
};
