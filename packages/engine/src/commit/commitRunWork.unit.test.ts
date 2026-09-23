import { execSync } from 'node:child_process';
import { describe, expect, jest, test } from '@jest/globals';
import { commitRunWork } from '#src/commit/index.ts';
import { WorktreeOwner } from '#src/contracts/index.ts';
import { committedPaths } from '#tests/helpers/committedPaths.ts';
import { generatedPaths } from '#tests/helpers/generatedPaths.ts';
import { headSubject } from '#tests/helpers/headSubject.ts';
import { configOf, createCommitRun, headCommitOf, manifestOf, plainSubject, planFolder, runId, setupCommitRun } from '#tests/helpers/setupCommitRun.ts';

// Mocked Imports
// -------------------------
// Git stays real here — the commit, the staging and the tree reads are what
// these cases are about. Only the HEAD read is stubbed, and by default it
// answers exactly what git answers, because no real repository makes a commit
// land and its next read say nothing. One case below arranges that anyway.
const mockReadGitHeadCommit = jest.fn<(params: { cwd: string }) => Promise<string | undefined>>();

jest.mock('#src/common/git/readGitHeadCommit.ts', () => ({
	readGitHeadCommit: (params: { cwd: string }) => mockReadGitHeadCommit(params),
}));
// -------------------------

/**
 * A commit run whose stubbed HEAD read answers exactly what git answers, which
 * is what every case here but one wants. The case that needs a git which stops
 * answering after a commit lands arranges that for itself.
 */
const setup = async (options: Parameters<typeof setupCommitRun>[0] = {}) => {
	mockReadGitHeadCommit.mockImplementation(async ({ cwd }) => headCommitOf({ cwd }));

	return setupCommitRun(options);
};

describe('commitRunWork', () => {
	test("commits the run's work and records the commit on the manifest", async () => {
		const { cwd, run, manifestNow } = await setup({ dirty: { 'src/thing.ts': 'export const thing = 1;\n' }, changedFiles: ['src/thing.ts'] });

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, carried: committedPaths({ cwd }), commits: manifestNow().commits }).toStrictEqual({
			uncommitted: undefined,
			carried: ['src/thing.ts'],
			commits: [{ sha: headCommitOf({ cwd }), subject: plainSubject, runId }],
		});
	});

	test('refuses a unit that changed no files at all', async () => {
		const { run, manifestNow } = await setup();

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, commits: manifestNow().commits }).toEqual({ uncommitted: expect.stringContaining('changed nothing'), commits: [] });
	});

	test('treats already-committed work as done rather than as changed nothing', async () => {
		const { run, manifestNow, progress } = await setup({ changedFiles: ['src/thing.ts'] });

		const uncommitted = await commitRunWork({ run, resumed: true });

		expect({ uncommitted, commits: manifestNow().commits, progress }).toEqual({
			uncommitted: undefined,
			commits: [],
			progress: expect.arrayContaining([expect.stringMatching(/already|history/i)]),
		});
	});

	test('refuses to commit a resumed checkout holding edits the run did not make', async () => {
		const { cwd, run, manifestNow } = await setup({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n', 'notes/stray.md': '# somebody else was here\n' },
			changedFiles: ['src/thing.ts'],
		});

		const uncommitted = await commitRunWork({ run, resumed: true });

		const staged = execSync('git diff --cached --name-only', { cwd }).toString();

		expect({ uncommitted, staged, commits: manifestNow().commits, subject: headSubject({ cwd }) }).toEqual({
			uncommitted: expect.stringContaining('notes/stray.md'),
			staged: '',
			commits: [],
			subject: 'ignore',
		});
	});

	test('commits a resumed run whose only unlisted changes are generated output', async () => {
		const { cwd, run } = await setup({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n', 'plugin/dist/chunk.mjs': '// built on the branch\n' },
			changedFiles: ['src/thing.ts'],
			generated: generatedPaths,
		});

		const uncommitted = await commitRunWork({ run, resumed: true });

		expect({ uncommitted, carried: committedPaths({ cwd }) }).toStrictEqual({ uncommitted: undefined, carried: ['src/thing.ts'] });
	});

	test('excludes generated paths on a manifest carrying no config snapshot', async () => {
		const { cwd, run, manifestNow } = await setup({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n', 'plugin/dist/chunk.mjs': '// built on the branch\n' },
			changedFiles: ['src/thing.ts'],
			generated: generatedPaths,
		});

		const uncommitted = await commitRunWork({ run, resumed: true });

		expect({ uncommitted, snapshot: manifestNow().config, carried: committedPaths({ cwd }) }).toStrictEqual({
			uncommitted: undefined,
			snapshot: undefined,
			carried: ['src/thing.ts'],
		});
	});

	test('commits a first run without comparing the tree', async () => {
		const { cwd, run } = await setup({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n', 'notes/stray.md': '# unreported by the worker\n' },
			changedFiles: ['src/thing.ts'],
		});

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, carried: committedPaths({ cwd }) }).toStrictEqual({ uncommitted: undefined, carried: ['notes/stray.md', 'src/thing.ts'] });
	});

	test('commits without comparison in any worktree lightsout owns', async () => {
		const { cwd, run } = await setup({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n', 'notes/stray.md': '# left by an earlier step\n' },
			changedFiles: ['src/thing.ts'],
			// A tree's ownership record is filed with the work order whose record
			// stores the branch, so the branch has to have one for it to exist.
			record: 'valid',
			owner: WorktreeOwner.Queue,
		});

		const uncommitted = await commitRunWork({ run, resumed: true });

		expect({ uncommitted, carried: committedPaths({ cwd }) }).toStrictEqual({ uncommitted: undefined, carried: ['notes/stray.md', 'src/thing.ts'] });
	});

	test('compares the tree of a resumed run that recorded no branch of its own', async () => {
		const { run } = await setup({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n', 'notes/stray.md': '# somebody else was here\n' },
			changedFiles: ['src/thing.ts'],
			branchOnManifest: false,
		});

		const uncommitted = await commitRunWork({ run, resumed: true });

		// No branch means no worktree record to ask about, which is not the same as
		// a record saying lightsout owns the tree: the comparison still runs.
		expect(uncommitted).toEqual(expect.stringContaining('notes/stray.md'));
	});

	test("narrates the commit through the run's progress sink", async () => {
		const { run, progress } = await setup({ dirty: { 'src/thing.ts': 'export const thing = 1;\n' }, changedFiles: ['src/thing.ts'] });

		await commitRunWork({ run, resumed: false });

		expect(progress).toEqual(expect.arrayContaining([expect.stringContaining(plainSubject)]));
	});

	test('discards generated output and reports that no source changed', async () => {
		const { cwd, run, manifestNow } = await setup({ dirty: { 'plugin/dist/chunk.mjs': '// built on the branch\n' }, generated: generatedPaths });

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, tree: execSync('git status --porcelain', { cwd }).toString(), commits: manifestNow().commits }).toEqual({
			uncommitted: expect.stringContaining('changed nothing'),
			tree: '',
			commits: [],
		});
	});

	test('refuses rather than reading an unreadable tree as no changes', async () => {
		const missing = '/lightsout/no/such/directory';
		const manifest = manifestOf({ plan: `${planFolder}/plan.md`, changedFiles: ['src/thing.ts'] });
		const { run, manifestNow } = createCommitRun({ cwd: missing, manifest, config: configOf({}) });

		const uncommitted = await commitRunWork({ run, subject: 'LO-152 nowhere', resumed: false });

		expect({ uncommitted, commits: manifestNow().commits }).toEqual({ uncommitted: expect.stringContaining(missing), commits: [] });
	});

	test('refuses when the commit it made cannot be named', async () => {
		const { cwd, run, manifestNow } = await setup({
			dirty: { 'src/thing.ts': 'export const thing = 1;\n' },
			changedFiles: ['src/thing.ts'],
		});

		// the git that stopped answering after committing — no real repository
		// makes a commit land and its next read say nothing
		mockReadGitHeadCommit.mockResolvedValue(undefined);

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, commits: manifestNow().commits, subject: headSubject({ cwd }) }).toEqual({
			uncommitted: expect.stringContaining('commit'),
			commits: [],
			subject: plainSubject,
		});
	});

	test('reads a run whose changed files are all generated as changed nothing', async () => {
		const { run, manifestNow } = await setup({ changedFiles: ['plugin/dist/chunk.mjs'], generated: generatedPaths });

		const uncommitted = await commitRunWork({ run, resumed: false });

		expect({ uncommitted, commits: manifestNow().commits }).toEqual({ uncommitted: expect.stringContaining('changed nothing'), commits: [] });
	});
});
