import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shipScenarioFixtures } from '#tests/helpers/shipScenarioFixtures.ts';

const { author, branch } = shipScenarioFixtures;

const git = ({ cwd, command }: { cwd: string; command: string }) => execSync(`git ${command}`, { cwd, stdio: 'ignore' });

const gitOut = ({ cwd, command }: { cwd: string; command: string }) => execSync(`git ${command}`, { cwd, encoding: 'utf8' }).trim();

const headOf = ({ cwd }: { cwd: string }) => gitOut({ cwd, command: 'rev-parse HEAD' });

/** What the remote holds for the feature branch, empty when nothing was ever pushed to it. */
const remoteTip = ({ cwd }: { cwd: string }) => gitOut({ cwd, command: `ls-remote --heads origin ${branch}` }).split('\t')[0] ?? '';

const isAncestor = ({ cwd, commit, of }: { cwd: string; commit: string; of: string }) => {
	try {
		git({ cwd, command: `merge-base --is-ancestor ${commit} ${of}` });

		return true;
	} catch {
		return false;
	}
};

/** A commit pushed to `origin/main` from a clone of its own, so the default branch can move while the checkout stands on its feature branch. */
const advanceDefaultBranch = ({ origin, path, content }: { origin: string; path: string; content: string }) => {
	const clone = mkdtempSync(join(tmpdir(), 'lightsout-main-'));

	execSync(`git clone -q ${origin} .`, { cwd: clone, stdio: 'ignore' });
	writeFileSync(join(clone, path), content);
	execSync(`git add -A && git ${author} commit -qm "the default branch moved" && git push -q origin main`, { cwd: clone, stdio: 'ignore' });

	return gitOut({ cwd: clone, command: 'rev-parse HEAD' });
};

/** A release hook the engine runs by its configured command string, kept outside the repository so it never dirties the tree it prepares. */
const writeHookScript = ({ body }: { body: string }) => {
	const path = join(mkdtempSync(join(tmpdir(), 'lightsout-hook-')), 'hook.js');

	writeFileSync(path, body);

	return path;
};

/** An untracked directory the recovery cannot delete, which is what makes a rollback fail for real rather than by arrangement. */
const lockStrayDirectory = ({ cwd }: { cwd: string }) => {
	if (existsSync(join(cwd, 'locked'))) {
		return;
	}

	mkdirSync(join(cwd, 'locked'));
	writeFileSync(join(cwd, 'locked', 'stray.txt'), 'left behind by the recovery\n');
	execSync('chmod 500 locked', { cwd, stdio: 'ignore' });
};

/**
 * Real git, and the world moving around it, for the scenarios a scripted ship
 * runs against.
 *
 * Nothing here is stubbed: the branch, the bare origin, the merges and the
 * pushes are the subject of these tests, and a stubbed git would prove none of
 * it.
 */
export const shipScenarioGit = { advanceDefaultBranch, git, gitOut, headOf, isAncestor, lockStrayDirectory, remoteTip, writeHookScript };
