import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { commitTicketWork } from '#src/queue/index.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A ticket branch as the queue finds one: an author git will accept, and run
 * state ignored the way a consumer repo ignores it — without that, `git add -A`
 * would sweep the run's own records into the ticket's commit.
 */
const setupTicketBranch = () => {
	const { cwd } = setupBranchRepo({ branch: 'lo-70-drain' });

	execSync('git config user.name t && git config user.email t@t', { cwd, stdio: 'ignore' });
	writeFileSync(join(cwd, '.gitignore'), '.lightsout/\n');
	execSync('git add -A && git commit -qm ignore', { cwd, stdio: 'ignore' });

	return { cwd, runDir: join(cwd, '.lightsout', 'runs', 'run-1') };
};

/** The subject line of the branch's newest commit. */
const headSubject = ({ cwd }: { cwd: string }) => execSync('git log -1 --pretty=%s', { cwd }).toString().trim();

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

		writeFileSync(join(cwd, 'src.ts'), 'export const value = 1;\n');

		const committed = await commitTicketWork({ cwd, message: 'LO-70 Drain the backlog', runDir });

		expect(committed).toStrictEqual({ committed: true });
		expect(headSubject({ cwd })).toBe('LO-70 Drain the backlog');
	});

	test('writes the message through a file, so no ticket title ever needs shell quoting', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeFileSync(join(cwd, 'src.ts'), 'export const value = 1;\n');
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

		writeFileSync(join(cwd, 'src.ts'), 'export const value = 1;\n');
		// An index git will not let go of is the simplest way to make staging fail
		// while the tree still reads as changed.
		writeFileSync(join(cwd, '.git', 'index.lock'), '');

		const committed = await commitTicketWork({ cwd, message: 'LO-70 blocked', runDir });

		expect(committed).toEqual({ error: expect.stringContaining(`git could not stage the work in ${cwd}`) });
	});

	test('reports what git refused rather than claiming a commit, when staging works and the commit itself is refused', async () => {
		const { cwd, runDir } = setupTicketBranch();

		writeFileSync(join(cwd, 'src.ts'), 'export const value = 1;\n');
		refuseCommits({ cwd });

		const committed = await commitTicketWork({ cwd, message: 'LO-70 refused', runDir });

		// the two refusals must never read as one: staged-but-uncommitted is a
		// different thing for a human to fix than nothing staged at all
		expect(committed).toEqual({ error: expect.stringContaining(`git could not commit the work in ${cwd}`) });
		// and the branch is left standing where it was, with no commit claimed
		expect(headSubject({ cwd })).toBe('ignore');
	});
});
