import { describe, expect, jest, test } from '@jest/globals';
import { describeUncommittableTree } from '#src/cli/common/implementRun/describeUncommittableTree.ts';

// Mocked Imports
// -------------------------
// The git status read has its own tests. What this file owns is the policy:
// which trees are judged at all, and what a judged tree is told.
const mockReadGitChangedFiles = jest.fn<(params: { cwd: string }) => Promise<string[] | undefined>>();

jest.mock('#src/common/git/readGitChangedFiles.ts', () => ({ readGitChangedFiles: (params: { cwd: string }) => mockReadGitChangedFiles(params) }));
// -------------------------

const dirtyCwd = '/repo-worktrees/lo-152-dirty';
const cleanCwd = '/repo-worktrees/lo-152-clean';

/**
 * What `git status` finds in each checkout, keyed by checkout path: a list of
 * uncommitted paths, an empty list for a clean tree, or undefined for a tree
 * git cannot read at all. A checkout the map does not name is clean.
 */
const setupTrees = ({ changed = {} }: { changed?: Record<string, string[] | undefined> } = {}) => {
	mockReadGitChangedFiles.mockImplementation(({ cwd }) => Promise.resolve(Object.hasOwn(changed, cwd) ? changed[cwd] : []));

	return { dirty: dirtyCwd, clean: cleanCwd };
};

describe('describeUncommittableTree', () => {
	test('refuses a dirty tree and accepts a clean one', async () => {
		const { dirty, clean } = setupTrees({ changed: { [dirtyCwd]: ['thing.ts'] } });

		const refused = await describeUncommittableTree({ cwd: dirty, isolated: false });
		const accepted = await describeUncommittableTree({ cwd: clean, isolated: false });

		// The checkout is named so a person reading the refusal knows which tree
		// to clean; the rest of the wording is theirs to change.
		expect({ refused, accepted }).toEqual({ refused: expect.stringContaining(dirty), accepted: undefined });
		expect(refused).toMatch(/commit|stash/i);
	});

	test('refuses a tree git cannot read', async () => {
		const { dirty } = setupTrees({ changed: { [dirtyCwd]: undefined } });

		const refusal = await describeUncommittableTree({ cwd: dirty, isolated: false });

		// An unreadable tree is never read as an empty one: the run ends in a
		// commit, so a checkout git cannot answer for is a stop, not a green light.
		expect(refusal).toEqual(expect.stringContaining(dirty));
	});

	test('never judges a tree lightsout owns', async () => {
		const { dirty } = setupTrees({ changed: { [dirtyCwd]: ['thing.ts'] } });

		const refusal = await describeUncommittableTree({ cwd: dirty, isolated: true });

		expect(refusal).toBeUndefined();
		// A tree lightsout cut or adopted for the run holds the ticket's own work,
		// so no git state is read at all and the run still starts.
		expect(mockReadGitChangedFiles).not.toHaveBeenCalled();
	});
});
