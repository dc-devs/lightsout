import { execSync } from 'node:child_process';
import { mkdirSync, realpathSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolveRunDir } from '#src/runState/common/paths/resolveRunDir.ts';
import { RunNotFoundError } from '#src/runState/RunNotFoundError.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

interface SetupParams {
	/**
	 * Run folders to plant, each a path under `.lightsout` ending in the run id —
	 * `work-orders/<name>/runs/<id>` for a run of a plan, `direct/runs/<id>` for one
	 * belonging to no plan.
	 */
	runDirs?: string[];
}

/**
 * A repository with run folders already on disk, in whichever locations the
 * case is about.
 *
 * Every case gets its own temporary repository, because the lookup remembers
 * what it found for the life of the process: two cases sharing a directory
 * would let one case's answer settle the next one's question.
 */
const setupRunLocations = ({ runDirs = [] }: SetupParams = {}) => {
	const cwd = setupConsumerRepo({ git: false });

	for (const runDir of runDirs) {
		mkdirSync(join(cwd, '.lightsout', runDir), { recursive: true });
	}

	return { cwd };
};

/**
 * A primary checkout with a linked worktree added from it, and one run folder
 * in the primary checkout's state directory — the shape an isolated run stands
 * in while its records belong to the checkout it was launched from.
 */
const setupLinkedWorktree = ({ runDir }: { runDir: string }) => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-155-ticket-scoped-state');

	execSync(`git worktree add -q -b lo-155-ticket-scoped-state "${worktree}" main`, { cwd, stdio: 'ignore' });
	mkdirSync(join(cwd, '.lightsout', runDir), { recursive: true });

	return { primary: cwd, worktree };
};

describe('resolveRunDir', () => {
	test('finds a run filed under the ticket its plan belongs to', async () => {
		const { cwd } = setupRunLocations({ runDirs: ['work-orders/lo-155-ticket-scoped-state/runs/be7bc314-1845-44c0-bb6c-a8c2becb7f92'] });

		const runDir = await resolveRunDir({ cwd, runId: 'be7bc314-1845-44c0-bb6c-a8c2becb7f92' });

		expect(runDir).toBe(join(cwd, '.lightsout', 'work-orders', 'lo-155-ticket-scoped-state', 'runs', 'be7bc314-1845-44c0-bb6c-a8c2becb7f92'));
	});

	test('finds a run filed under the command that owns it', async () => {
		const { cwd } = setupRunLocations({ runDirs: ['direct/runs/be7bc314-1845-44c0-bb6c-a8c2becb7f92'] });

		const runDir = await resolveRunDir({ cwd, runId: 'be7bc314-1845-44c0-bb6c-a8c2becb7f92' });

		expect(runDir).toBe(join(cwd, '.lightsout', 'direct', 'runs', 'be7bc314-1845-44c0-bb6c-a8c2becb7f92'));
	});

	test('takes the shortened id a report prints, and prefers an exact id over one it prefixes', async () => {
		const { cwd } = setupRunLocations({
			runDirs: ['work-orders/lo-155-ticket-scoped-state/runs/be7bc314-1845-44c0-bb6c-a8c2becb7f92', 'direct/runs/abcdefgh', 'direct/runs/abcdefgh-2222'],
		});

		// the eight characters printResult shows are what a user copies back
		const shortened = await resolveRunDir({ cwd, runId: 'be7bc314' });
		const exact = await resolveRunDir({ cwd, runId: 'abcdefgh' });

		expect({ shortened, exact }).toStrictEqual({
			shortened: join(cwd, '.lightsout', 'work-orders', 'lo-155-ticket-scoped-state', 'runs', 'be7bc314-1845-44c0-bb6c-a8c2becb7f92'),
			exact: join(cwd, '.lightsout', 'direct', 'runs', 'abcdefgh'),
		});
	});

	test('refuses to guess between two runs sharing a prefix, and names them', async () => {
		const { cwd } = setupRunLocations({
			runDirs: ['work-orders/lo-155-ticket-scoped-state/runs/abcd-1111', 'refactor/runs/abcd-2222'],
		});

		await expect(resolveRunDir({ cwd, runId: 'abcd' })).rejects.toThrow(RunNotFoundError);
		await expect(resolveRunDir({ cwd, runId: 'abcd' })).rejects.toThrow(/abcd-1111/);
		await expect(resolveRunDir({ cwd, runId: 'abcd' })).rejects.toThrow(/abcd-2222/);
	});

	test('names the run id it could not find instead of failing on a path', async () => {
		const { cwd } = setupRunLocations({ runDirs: ['work-orders/lo-155-ticket-scoped-state/runs/aaaaaaaa-1111'] });

		await expect(resolveRunDir({ cwd, runId: 'bbbbbbbb' })).rejects.toThrow(RunNotFoundError);
		await expect(resolveRunDir({ cwd, runId: 'bbbbbbbb' })).rejects.toThrow(/bbbbbbbb/);
	});

	test('re-scans once on a miss, so a run created after the first scan is found', async () => {
		const { cwd } = setupRunLocations({ runDirs: ['queue/runs/aaaaaaaa-1111'] });

		await expect(resolveRunDir({ cwd, runId: 'bbbbbbbb-2222' })).rejects.toThrow(RunNotFoundError);
		mkdirSync(join(cwd, '.lightsout', 'work-orders', 'lo-155-ticket-scoped-state', 'runs', 'bbbbbbbb-2222'), { recursive: true });
		const runDir = await resolveRunDir({ cwd, runId: 'bbbbbbbb-2222' });

		expect(runDir).toBe(join(cwd, '.lightsout', 'work-orders', 'lo-155-ticket-scoped-state', 'runs', 'bbbbbbbb-2222'));
	});

	test('answers a second lookup from memory rather than reading the locations again', async () => {
		const { cwd } = setupRunLocations({ runDirs: ['work-orders/lo-155-ticket-scoped-state/runs/be7bc314-1845-44c0-bb6c-a8c2becb7f92'] });
		const planted = join(cwd, '.lightsout', 'work-orders', 'lo-155-ticket-scoped-state', 'runs', 'be7bc314-1845-44c0-bb6c-a8c2becb7f92');

		await resolveRunDir({ cwd, runId: 'be7bc314-1845-44c0-bb6c-a8c2becb7f92' });
		renameSync(planted, join(cwd, '.lightsout', 'work-orders', 'lo-155-ticket-scoped-state', 'runs', 'moved-aside'));
		const runDir = await resolveRunDir({ cwd, runId: 'be7bc314-1845-44c0-bb6c-a8c2becb7f92' });

		expect(runDir).toBe(planted);
	});

	test('resolves a run against the primary checkout from a linked worktree', async () => {
		const { primary, worktree } = setupLinkedWorktree({
			runDir: 'work-orders/lo-155-ticket-scoped-state/runs/be7bc314-1845-44c0-bb6c-a8c2becb7f92',
		});

		const runDir = await resolveRunDir({ cwd: worktree, runId: 'be7bc314-1845-44c0-bb6c-a8c2becb7f92' });

		expect(runDir).toBe(join(realpathSync(primary), '.lightsout', 'work-orders', 'lo-155-ticket-scoped-state', 'runs', 'be7bc314-1845-44c0-bb6c-a8c2becb7f92'));
	});
});
