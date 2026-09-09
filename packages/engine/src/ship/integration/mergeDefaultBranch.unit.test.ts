import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { mergeDefaultBranch } from '#src/ship/integration/mergeDefaultBranch.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

// Git is real here rather than stubbed: what this step answers is git's own
// reading of a fetch, an ancestor check and a merge, and a stubbed git would
// prove nothing about a conflict. Only the remote is local — a bare repo on
// disk — so nothing leaves the machine.

const author = '-c user.name=t -c user.email=t@t';

/** The commit the checkout stands on right now. */
const readHead = ({ cwd }: { cwd: string }) => execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

/** The commit a ref names right now. */
const readRef = ({ cwd, ref }: { cwd: string; ref: string }) => execSync(`git rev-parse ${ref}`, { cwd, encoding: 'utf8' }).trim();

/** Whether git still has a merge open, which is how "left for the caller" is read. */
const hasOpenMerge = ({ cwd }: { cwd: string }) => existsSync(join(cwd, '.git', 'MERGE_HEAD'));

/** A feature branch built on top of the pushed default branch, so `origin/main` is already an ancestor of `HEAD`. */
const setupUpToDateBranch = () => {
	const { cwd } = setupBranchRepo({ branch: 'lo-89-ship' });

	return { cwd, head: readHead({ cwd }), base: readRef({ cwd, ref: 'origin/main' }) };
};

/** A feature branch and a pushed default branch that changed the same line of the same file. */
const setupConflictingBranch = () => {
	const { cwd } = setupBranchRepo();
	const git = (command: string) => execSync(command, { cwd, stdio: 'ignore' });

	writeRepoFile({ cwd, path: 'shared.md', content: 'the original line\n' });
	git(`git add -A && git ${author} commit -qm shared && git push -q origin main`);

	git('git checkout -q -b lo-89-ship');
	writeRepoFile({ cwd, path: 'shared.md', content: 'the branch line\n' });
	git(`git add -A && git ${author} commit -qm "the branch edit"`);

	git('git checkout -q main');
	writeRepoFile({ cwd, path: 'shared.md', content: 'the default branch line\n' });
	git(`git add -A && git ${author} commit -qm "the default branch edit" && git push -q origin main`);
	git('git checkout -q lo-89-ship');

	return { cwd, head: readHead({ cwd }) };
};

/** A feature branch whose `origin` points at a path that holds no repository, so the fetch cannot work. */
const setupUnreachableOrigin = () => {
	const { cwd } = setupBranchRepo({ branch: 'lo-89-ship' });

	execSync('git remote set-url origin /lightsout/no/such/origin', { cwd, stdio: 'ignore' });

	return { cwd, head: readHead({ cwd }) };
};

describe('mergeDefaultBranch', () => {
	test('reports nothing integrated when the remote default branch is already an ancestor', async () => {
		const { cwd, head, base } = setupUpToDateBranch();

		const outcome = await mergeDefaultBranch({ cwd, defaultBranch: 'main' });

		expect(outcome).toEqual(expect.objectContaining({ baseCommit: base, conflictPaths: [], integrated: false, failure: undefined }));
		expect({ head: readHead({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ head, openMerge: false });
	});

	test('leaves a conflicted merge open and names the conflicting path', async () => {
		const { cwd, head } = setupConflictingBranch();

		const outcome = await mergeDefaultBranch({ cwd, defaultBranch: 'main' });

		expect(outcome).toEqual(expect.objectContaining({ conflictPaths: ['shared.md'], integrated: true, failure: undefined }));
		expect({ head: readHead({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ head, openMerge: true });
	});

	test('reports a failure rather than a merge when origin cannot be fetched', async () => {
		const { cwd, head } = setupUnreachableOrigin();

		const outcome = await mergeDefaultBranch({ cwd, defaultBranch: 'main' });

		expect(outcome).toEqual(expect.objectContaining({ conflictPaths: [], integrated: false, failure: expect.any(String) }));
		expect({ head: readHead({ cwd }), openMerge: hasOpenMerge({ cwd }) }).toStrictEqual({ head, openMerge: false });
	});
});
