import { execSync } from 'node:child_process';
import { describe, expect, test } from '@jest/globals';
import { readGitRefCommit } from '#src/common/git/readGitRefCommit.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

const setupTicketBranch = () => {
	const cwd = setupConsumerRepo();

	execSync('git branch lo-7-search', { cwd });

	return { cwd, tip: execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim() };
};

/** A repo carrying an annotated tag, whose own object id is not the commit it points at. */
const setupAnnotatedTag = () => {
	const cwd = setupConsumerRepo();

	execSync('git -c user.name=t -c user.email=t@t tag -a v1 -m "the release"', { cwd });

	return {
		cwd,
		tip: execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim(),
		tagObject: execSync('git rev-parse refs/tags/v1', { cwd, encoding: 'utf8' }).trim(),
	};
};

describe('readGitRefCommit', () => {
	test('answers the commit a ref names and nothing for a missing ref', async () => {
		const { cwd, tip } = setupTicketBranch();

		const named = await readGitRefCommit({ cwd, ref: 'refs/heads/lo-7-search' });
		const missing = await readGitRefCommit({ cwd, ref: 'refs/remotes/origin/lo-7-search' });

		// the branch's own tip, full sha and trimmed: a later plan's tree is cut
		// here, so a stale or decorated answer would start it at the wrong commit
		expect(named).toBe(tip);
		expect(named ?? '').toMatch(/^[0-9a-f]{40}$/);
		// a ref nobody created is absence, not a raised error
		expect(missing).toBe(undefined);
	});

	test('peels an annotated tag to the commit it points at rather than the tag object', async () => {
		const { cwd, tip, tagObject } = setupAnnotatedTag();

		const peeled = await readGitRefCommit({ cwd, ref: 'refs/tags/v1' });

		// the two ids differ, so answering the tag object would be a tree cut at a
		// commit that does not exist; the peel suffix only survives because the
		// ref is quoted on its way to the shell
		expect({ peeled, differs: tagObject !== tip }).toStrictEqual({ peeled: tip, differs: true });
	});
});
