import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { commitTicketWork } from '#src/queue/index.ts';
import { committedPaths } from '#tests/helpers/committedPaths.ts';
import { generatedPaths } from '#tests/helpers/generatedPaths.ts';
import { headSubject } from '#tests/helpers/headSubject.ts';
import { setupTicketBranch } from '#tests/helpers/setupTicketBranch.ts';
import { writeRepoFile } from '#tests/helpers/writeRepoFile.ts';

/**
 * A repo whose own pre-commit hook refuses the commit — staging still succeeds,
 * so this is the one arrangement that reaches the commit step's own refusal
 * rather than the staging step's. The hook lives under `.git/`, where
 * `git add -A` cannot see it, and the path is set in the repo's own config so a
 * machine-wide hooks directory cannot take its place.
 */
const refuseCommits = ({ cwd }: { cwd: string }) => {
	const hooks = join(cwd, '.git', 'refusing-hooks');

	mkdirSync(hooks, { recursive: true });
	writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho "this repo refuses commits" >&2\nexit 1\n', { mode: 0o755 });
	execSync(`git config core.hooksPath ${hooks}`, { cwd, stdio: 'ignore' });
};

describe('commitTicketWork', () => {
	test('commits everything the worker changed and says it committed, so a caller can tell a commit from a no-op', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-70 Drain the backlog', runDir });

		expect(committed).toStrictEqual({ committed: true });
		expect(headSubject({ cwd })).toBe('LO-70 Drain the backlog');
	});

	test('writes the message through a file, so no ticket title ever needs shell quoting', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		await commitTicketWork({ cwd, message: "LO-70 Don't `break` $(this)", runDir });

		expect(readFileSync(join(runDir, 'commit-message.txt'), 'utf8')).toBe("LO-70 Don't `break` $(this)\n");
		expect(headSubject({ cwd })).toBe("LO-70 Don't `break` $(this)");
	});

	test('reports a tree the worker never touched rather than making an empty commit', async () => {
		const { cwd, runDir } = setupTicketBranch();

		expect(await commitTicketWork({ cwd, message: 'LO-70 nothing', runDir })).toStrictEqual({ committed: false });
	});

	test('refuses a tree git cannot read, because a commit cannot be promised over one', async () => {
		const committed = await commitTicketWork({
			cwd: '/lightsout/no/such/directory',
			message: 'LO-70 nowhere',
			runDir: '/lightsout/no/such/directory/.lightsout',
		});

		expect(committed).toStrictEqual({ error: 'git could not read the tree at /lightsout/no/such/directory' });
	});

	test('reports what git refused rather than claiming a commit, when the work cannot be staged', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		// An index git will not let go of is the simplest way to make staging fail
		// while the tree still reads as changed.
		writeFileSync(join(cwd, '.git', 'index.lock'), '');

		const committed = await commitTicketWork({ cwd, message: 'LO-70 blocked', runDir });

		expect(committed).toEqual({ error: expect.stringContaining(`git could not stage the work in ${cwd}`) });
	});

	test('reports what git refused rather than claiming a commit, when staging works and the commit itself is refused', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		refuseCommits({ cwd });

		const committed = await commitTicketWork({ cwd, message: 'LO-70 refused', runDir });

		// the two refusals must never read as one: staged-but-uncommitted is a
		// different thing for a human to fix than nothing staged at all
		expect(committed).toEqual({ error: expect.stringContaining(`git could not commit the work in ${cwd}`) });
		// and the branch is left standing where it was, with no commit claimed
		expect(headSubject({ cwd })).toBe('ignore');
	});

	test('leaves a generated file out of the commit, so the branch carries source only', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 source only', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['src.ts']);
	});

	test('restores a tracked generated file the worker rewrote, so the branch carries no stale build output', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/cli.mjs', content: '// rebuilt on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 no stale output', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(readFileSync(join(cwd, 'plugin', 'dist', 'cli.mjs'), 'utf8')).toBe('// built on main\n');
		expect(committedPaths({ cwd })).toStrictEqual(['src.ts']);
	});

	test('reports nothing to commit when the only change was generated output', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 build only', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: false });
		expect(headSubject({ cwd })).toBe('ignore');
	});

	test("leaves the working tree clean, so the ship step's dirty-tree check still passes", async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });

		await commitTicketWork({ cwd, message: 'LO-79 build only', runDir, generated: generatedPaths });

		expect(execSync('git status --porcelain', { cwd }).toString()).toBe('');
	});

	test("commits generated paths when the repo configures none, which is exactly today's behaviour", async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 no generated configured', runDir });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['plugin/dist/chunk.mjs']);
	});

	test('commits a vendored file the worker edited, because a vendored edit is the change itself', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({
			cwd,
			path: 'packages/web-app/src/common/components/ui/button.tsx',
			content: 'export const Button = () => null;\n',
		});

		const committed = await commitTicketWork({ cwd, message: 'LO-79 vendored edit', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['packages/web-app/src/common/components/ui/button.tsx']);
	});

	test('discards a configured single file as well as a configured directory prefix', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });
		writeRepoFile({ cwd, path: 'packages/web-app/src/routeTree.gen.ts', content: 'export const routeTree = 1;\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 both shapes', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['src.ts']);
	});

	test('discards a generated path whose name carries glob characters', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/[slug].mjs', content: '// built on the branch\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 glob name', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['src.ts']);
		expect(existsSync(join(cwd, 'plugin', 'dist', '[slug].mjs'))).toBe(false);
	});

	test('says how many generated paths it discarded, so an unattended run records why the branch carries no build output', async () => {
		const { cwd, runDir } = setupTicketBranch();
		const lines: string[] = [];

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/chunk.mjs', content: '// built on the branch\n' });
		writeRepoFile({ cwd, path: 'packages/web-app/src/routeTree.gen.ts', content: 'export const routeTree = 1;\n' });

		await commitTicketWork({
			cwd,
			message: 'LO-79 says what it discarded',
			runDir,
			generated: generatedPaths,
			onProgress: (message) => lines.push(message),
		});

		expect(lines).toEqual(expect.arrayContaining([expect.stringContaining('discarded 2 generated path(s)')]));
	});

	test('reports what git refused rather than claiming a commit, when the generated changes cannot be discarded', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'plugin/dist/cli.mjs', content: '// rebuilt on the branch\n' });
		// An index git will not let go of is the simplest way to make the discard
		// fail while the tree still reads as changed.
		writeFileSync(join(cwd, '.git', 'index.lock'), '');

		const committed = await commitTicketWork({ cwd, message: 'LO-79 discard blocked', runDir, generated: generatedPaths });

		expect(committed).toEqual({ error: expect.stringContaining(`git could not discard the generated changes in ${cwd}`) });
	});

	test('commits a source file whose name merely begins with a configured generated entry', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'plugin/distortion.ts', content: 'export const distort = () => null;\n' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 segment boundary', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['plugin/distortion.ts']);
	});

	test('discards generated changes an earlier refused attempt had already staged, so a resumed run still commits source only', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeRepoFile({ cwd, path: 'src.ts', content: 'export const value = 1;\n' });
		writeRepoFile({ cwd, path: 'plugin/dist/cli.mjs', content: '// rebuilt on the branch\n' });
		// stands in for the earlier attempt whose own `git add -A` staged the build
		// output before its `git commit` was refused
		execSync('git add -A', { cwd, stdio: 'ignore' });

		const committed = await commitTicketWork({ cwd, message: 'LO-79 resumed run', runDir, generated: generatedPaths });

		expect(committed).toStrictEqual({ committed: true });
		expect(committedPaths({ cwd })).toStrictEqual(['src.ts']);
		expect(readFileSync(join(cwd, 'plugin', 'dist', 'cli.mjs'), 'utf8')).toBe('// built on main\n');
	});
});
