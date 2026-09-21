import { execSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/**
 * A primary checkout with a linked worktree added from it — the shape every
 * plan command runs in once `plan.worktree` moves the session into a tree, and
 * the one place a plan folder could be written somewhere that gets removed.
 */
const setupLinkedWorktree = () => {
	const { cwd } = setupBranchRepo();
	const worktree = join(cwd, '.worktrees', 'lo-150-planning-observability');

	execSync(`git worktree add -q -b lo-150-planning-observability "${worktree}" main`, { cwd, stdio: 'ignore' });

	return { primary: cwd, worktree };
};

/** A directory with no repository above it, so git can answer nothing. */
const setupLooseDirectory = () => {
	const cwd = mkdtempSync(join(tmpdir(), 'lightsout-plan-workspace-'));

	return { cwd };
};

describe('planWorkspaceDir', () => {
	test("answers the primary checkout's plan folder from inside a linked worktree", async () => {
		const { primary, worktree } = setupLinkedWorktree();

		const dir = await planWorkspaceDir({ cwd: worktree, name: 'lo-150-planning-observability' });

		expect(dir).toBe(join(realpathSync(primary), '.lightsout', 'tickets', 'lo-150-planning-observability', 'plans'));
	});

	test('falls back to the given directory when no primary checkout resolves', async () => {
		const { cwd } = setupLooseDirectory();

		const dir = await planWorkspaceDir({ cwd, name: 'rate-limit-banner' });

		expect(dir).toBe(join(cwd, '.lightsout', 'tickets', 'rate-limit-banner', 'plans'));
	});

	test("planWorkspaceDir: an address answers a plan subfolder and a bare name answers the ticket's plans folder", async () => {
		const { cwd } = setupLooseDirectory();

		const addressed = await planWorkspaceDir({ cwd, name: 'lo-155-ticket-scoped-state/001-ticket-folder' });
		const bare = await planWorkspaceDir({ cwd, name: 'rate-limit-banner' });

		expect({ addressed, bare }).toStrictEqual({
			addressed: join(cwd, '.lightsout', 'tickets', 'lo-155-ticket-scoped-state', 'plans', '001-ticket-folder'),
			bare: join(cwd, '.lightsout', 'tickets', 'rate-limit-banner', 'plans'),
		});
	});
});
