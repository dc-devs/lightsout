import { execSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { prepareWorkOrderBranch } from '#src/worktree/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

// Git is real here rather than stubbed, as it is for every other reader of a
// remote in this module: what this answers is git's own reading of two refs and
// of `merge-base --is-ancestor`, and a stubbed git would prove nothing about
// either. Only the remote is local — a bare repo on disk — so nothing leaves
// the machine.

/** The ticket branch every arrangement below builds, named as a ticket folder is. */
const workOrderName = 'lo-7-search';

/** The commit a ref names, read straight from git so a test never trusts the subject's own answer. */
const readCommit = ({ cwd, ref }: { cwd: string; ref: string }): string => execSync(`git rev-parse ${ref}`, { cwd, encoding: 'utf8' }).trim();

/** The sentence a refusal carries, or an empty string when the call answered a start point instead. */
const refusalOf = (prepared: { startPoint?: string } | { error: string }): string => ('error' in prepared ? prepared.error : '');

/**
 * A repo whose ticket branch exists both locally and on the remote, standing in
 * the named relation to its pushed copy.
 *
 * `heldInTree` leaves the checkout standing on the ticket branch, which is what
 * a worktree holding the branch looks like to `git worktree list`; otherwise the
 * checkout returns to `main` and no tree holds it.
 */
const setupPushedTicketBranch = ({ relation, heldInTree = false }: { relation: 'behind' | 'ahead' | 'diverged'; heldInTree?: boolean }) => {
	const { cwd } = setupBranchRepo();
	const git = (command: string) => execSync(command, { cwd, stdio: 'ignore' });

	git(`git checkout -b ${workOrderName}`);
	git('git commit --allow-empty -m "the first plan"');
	git(`git push origin ${workOrderName}`);

	const shared = readCommit({ cwd, ref: 'HEAD' });

	git('git commit --allow-empty -m "the second plan"');

	if (relation !== 'ahead') {
		git(`git push origin ${workOrderName}`);
		git(`git reset --hard ${shared}`);
	}

	if (relation === 'diverged') {
		git('git commit --allow-empty -m "a local repair"');
	}

	if (!heldInTree) {
		git('git checkout main');
	}

	return {
		cwd,
		local: readCommit({ cwd, ref: `refs/heads/${workOrderName}` }),
		remote: readCommit({ cwd, ref: `refs/remotes/origin/${workOrderName}` }),
	};
};

/**
 * A repo whose ticket branch carries one commit and nothing more — pushed to
 * the remote, so local and pushed name the same commit, or never sent, so no
 * remote-tracking ref for it exists at all.
 *
 * These are the two arrangements that need no reconciling, and the only ones in
 * which git is asked to compare nothing.
 */
const setupLevelTicketBranch = ({ pushed }: { pushed: boolean }) => {
	const { cwd } = setupBranchRepo();
	const git = (command: string) => execSync(command, { cwd, stdio: 'ignore' });

	git(`git checkout -b ${workOrderName}`);
	git('git commit --allow-empty -m "the only plan"');

	if (pushed) {
		git(`git push origin ${workOrderName}`);
	}

	git('git checkout main');

	return { cwd, local: readCommit({ cwd, ref: `refs/heads/${workOrderName}` }) };
};

/**
 * A repo whose ticket branch is strictly behind the pushed one, held by no
 * tree, and whose ref is locked — what another git process mid-write leaves
 * behind, and the one arrangement in which the move is attempted and fails.
 */
const setupLockedTicketBranch = () => {
	const behind = setupPushedTicketBranch({ relation: 'behind' });
	const heads = join(behind.cwd, '.git', 'refs', 'heads');

	mkdirSync(heads, { recursive: true });
	writeFileSync(join(heads, `${workOrderName}.lock`), '');

	return behind;
};

/** A repo where the ticket branch was pushed and then dropped locally — a fresh machine that only fetched. */
const setupRemoteOnlyTicketBranch = () => {
	const { cwd } = setupBranchRepo();
	const git = (command: string) => execSync(command, { cwd, stdio: 'ignore' });

	git(`git checkout -b ${workOrderName}`);
	git('git commit --allow-empty -m "the pushed implementation"');
	git(`git push origin ${workOrderName}`);
	git('git checkout main');
	git(`git branch -D ${workOrderName}`);

	return { cwd, remote: readCommit({ cwd, ref: `refs/remotes/origin/${workOrderName}` }) };
};

describe('prepareWorkOrderBranch', () => {
	test('fast-forwards a local work-order branch that is strictly behind the pushed one when no tree holds it', async () => {
		const { cwd, remote } = setupPushedTicketBranch({ relation: 'behind' });

		const prepared = await prepareWorkOrderBranch({ cwd, branch: workOrderName });

		expect({ prepared, movedTo: readCommit({ cwd, ref: `refs/heads/${workOrderName}` }) }).toEqual({ prepared: {}, movedTo: remote });
	});

	test('keeps a ticket branch level with the pushed one, and one the remote never received, where they stand', async () => {
		const level = setupLevelTicketBranch({ pushed: true });
		const unpushed = setupLevelTicketBranch({ pushed: false });

		const fromLevel = await prepareWorkOrderBranch({ cwd: level.cwd, branch: workOrderName });
		const fromUnpushed = await prepareWorkOrderBranch({ cwd: unpushed.cwd, branch: workOrderName });

		// no start point either way, so the tree is cut from the local branch as it
		// stands, and neither branch is moved — a fast-forward here would rewrite a
		// ticket branch nobody asked about
		expect({
			fromLevel,
			fromUnpushed,
			levelStillAt: readCommit({ cwd: level.cwd, ref: `refs/heads/${workOrderName}` }),
			unpushedStillAt: readCommit({ cwd: unpushed.cwd, ref: `refs/heads/${workOrderName}` }),
		}).toEqual({ fromLevel: {}, fromUnpushed: {}, levelStillAt: level.local, unpushedStillAt: unpushed.local });
	});

	test('refuses a ticket branch that is behind the pushed one while a tree holds it', async () => {
		const { cwd, local, remote } = setupPushedTicketBranch({ relation: 'behind', heldInTree: true });

		const prepared = await prepareWorkOrderBranch({ cwd, branch: workOrderName });

		const refusal = refusalOf(prepared);

		expect({
			namesLocalCommit: refusal.includes(local),
			namesPushedCommit: refusal.includes(remote),
			namesTree: refusal.includes(realpathSync(cwd)),
			stillAt: readCommit({ cwd, ref: `refs/heads/${workOrderName}` }),
		}).toStrictEqual({ namesLocalCommit: true, namesPushedCommit: true, namesTree: true, stillAt: local });
	});

	test('reports a fast-forward git would not make, naming the branch and the commit it was to reach', async () => {
		const { cwd, local, remote } = setupLockedTicketBranch();

		const prepared = await prepareWorkOrderBranch({ cwd, branch: workOrderName });

		const refusal = refusalOf(prepared);

		// a move git declined is an answer, not a start point: reporting it as `{}`
		// would let a tree be cut on a branch still carrying the earlier plan's tip
		expect({
			namesBranch: refusal.includes(workOrderName),
			namesPushedCommit: refusal.includes(remote),
			stillAt: readCommit({ cwd, ref: `refs/heads/${workOrderName}` }),
		}).toStrictEqual({ namesBranch: true, namesPushedCommit: true, stillAt: local });
	});

	test('refuses a ticket branch that has diverged from the pushed one', async () => {
		const { cwd, local, remote } = setupPushedTicketBranch({ relation: 'diverged' });

		const prepared = await prepareWorkOrderBranch({ cwd, branch: workOrderName });

		const refusal = refusalOf(prepared);

		expect({
			namesLocalCommit: refusal.includes(local),
			namesPushedCommit: refusal.includes(remote),
			stillAt: readCommit({ cwd, ref: `refs/heads/${workOrderName}` }),
		}).toStrictEqual({ namesLocalCommit: true, namesPushedCommit: true, stillAt: local });
	});

	test('starts from the pushed branch when only the remote holds it and keeps a local branch that is ahead', async () => {
		const remoteOnly = setupRemoteOnlyTicketBranch();
		const ahead = setupPushedTicketBranch({ relation: 'ahead' });

		const fromRemote = await prepareWorkOrderBranch({ cwd: remoteOnly.cwd, branch: workOrderName });
		const fromLocal = await prepareWorkOrderBranch({ cwd: ahead.cwd, branch: workOrderName });

		expect({ fromRemote, fromLocal, stillAt: readCommit({ cwd: ahead.cwd, ref: `refs/heads/${workOrderName}` }) }).toEqual({
			fromRemote: { startPoint: remoteOnly.remote },
			fromLocal: {},
			stillAt: ahead.local,
		});
	});
});
