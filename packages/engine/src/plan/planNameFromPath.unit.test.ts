import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { expect, test } from '@jest/globals';
import { planNameFromPath } from '#src/plan/planNameFromPath.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** A repo root the cases resolve against — nothing is read from disk, so it need not exist. */
const cwd = resolve('/repo');

test('planNameFromPath: a plan folder under the plans directory answers its own name', async () => {
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-52-status-progress', 'plans') })).toBe('lo-52-status-progress');
});

test('planNameFromPath: a plan.md inside a plan folder answers the folder, not the file', async () => {
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-52-status-progress', 'plans', 'plan.md') })).toBe(
		'lo-52-status-progress',
	);
});

test('planNameFromPath: an absolute path into the plans directory reads the same as the relative one', async () => {
	expect(await planNameFromPath({ cwd, planPath: join(cwd, '.lightsout', 'work-orders', 'rate-limit-banner', 'plans', 'overview.md') })).toBe(
		'rate-limit-banner',
	);
});

test('planNameFromPath: a path outside the plans directory is not a plan workspace', async () => {
	// a --plan pointing at an arbitrary markdown file has no folder-name
	// convention to keep, so warning about its parent would be noise
	expect(await planNameFromPath({ cwd, planPath: 'ghost.md' })).toBe(undefined);
	expect(await planNameFromPath({ cwd, planPath: join('plans', 'demo', 'plan.md') })).toBe(undefined);
});

test('planNameFromPath: the plans directory itself names no plan', async () => {
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders') })).toBe(undefined);
});

test('planNameFromPath: a path above the plans directory answers undefined rather than a walk-up segment', async () => {
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'runs', 'latest') })).toBe(undefined);
	expect(await planNameFromPath({ cwd, planPath: resolve('/elsewhere/plans/demo') })).toBe(undefined);
});

test('planNameFromPath: a file inside a plan subfolder of a ticket folder answers the plan address', async () => {
	// the address is spelled with `/` whatever the platform's path separator is,
	// because it is the `--name` value every plan subcommand takes
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search', 'plans', '001-search-basics', 'plan.md') })).toBe(
		'lo-7-search/001-search-basics',
	);
});

test('planNameFromPath: a file deeper inside a plan subfolder still answers that plan address', async () => {
	// only the first two segments under the plans directory decide the address,
	// so a path that walks further into the plan's own files reads the same
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search', 'plans', '001-search-basics', 'decisions', 'log.md') })).toBe(
		'lo-7-search/001-search-basics',
	);
});

test('planNameFromPath: a plan subfolder given without a file answers its plan address', async () => {
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search', 'plans', '002-ranking') })).toBe('lo-7-search/002-ranking');
});

test('planNameFromPath: a subfolder whose name is not a plan id leaves the legacy folder name', async () => {
	expect(await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search', 'plans', 'implemented', 'phase1-search.md') })).toBe(
		'lo-7-search',
	);
});

/**
 * A primary checkout with a linked worktree added from it — the shape a plan
 * command runs in once planning moved into a worktree, and the one place a
 * repo-relative plan path and the plans directory can be rooted differently.
 */
const setupLinkedWorktree = () => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-150-planning-observability');

	execSync(`git worktree add -q -b lo-150-planning-observability "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	return { primary, worktree };
};

test('a plans-directory path given from a linked worktree still answers its plan name', async () => {
	const { worktree } = setupLinkedWorktree();

	const name = await planNameFromPath({ cwd: worktree, planPath: join('.lightsout', 'work-orders', 'lo-52-status-progress', 'plans', 'plan.md') });

	expect(name).toBe('lo-52-status-progress');
});

test("planNameFromPath: a plan subfolder answers its address and a loose file answers the ticket's own name", async () => {
	// the address is spelled with `/` whatever the platform's path separator is,
	// because it is the `--name` value every plan subcommand takes
	const addressed = await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search', 'plans', '001-search-basics', 'plan.md') });
	const loose = await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search', 'plans', 'facts.json') });

	expect({ addressed, loose }).toStrictEqual({ addressed: 'lo-7-search/001-search-basics', loose: 'lo-7-search' });
});

test("planNameFromPath: a path under a ticket's runs folder, and the ticket folder itself, belong to no plan", async () => {
	// phase 2 stamps this answer onto every run manifest, so a run inside a
	// ticket folder that belongs to no plan must answer undefined here
	const underRuns = await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search', 'runs', '20260101-abc', 'worklist.md') });
	const workOrderFolder = await planNameFromPath({ cwd, planPath: join('.lightsout', 'work-orders', 'lo-7-search') });

	expect({ underRuns, workOrderFolder }).toStrictEqual({ underRuns: undefined, workOrderFolder: undefined });
});

test('planNameFromPath: a path outside the tickets folder is no plan', async () => {
	// a --plan pointing at an arbitrary markdown file has no folder-name
	// convention to keep, so naming its parent folder would be noise
	const arbitrary = await planNameFromPath({ cwd, planPath: 'ghost.md' });
	const walkUp = await planNameFromPath({ cwd, planPath: join('.lightsout', 'runs', 'latest') });
	const otherRepo = await planNameFromPath({ cwd, planPath: resolve('/elsewhere/tickets/lo-7-search/plans/001-search-basics') });

	expect({ arbitrary, walkUp, otherRepo }).toStrictEqual({ arbitrary: undefined, walkUp: undefined, otherRepo: undefined });
});
