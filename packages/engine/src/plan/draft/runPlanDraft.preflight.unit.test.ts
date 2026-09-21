import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { DraftImplementation } from '#src/contracts/index.ts';
import type { Driver, DriverInvocation } from '#src/drivers/index.ts';
import { runPlanDraft } from '#src/plan/draft/runPlanDraft.ts';
import { sourceEvidencePath } from '#src/plan/evidence/index.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { createDraftDriver } from '#tests/helpers/createDraftDriver.ts';
import { expectStatus } from '#tests/helpers/expectStatus.ts';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { seedPlanWorkspace } from '#tests/helpers/seedPlanWorkspace.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';

/**
 * A seeded plan workspace whose driver answers to `omp` — the one registered
 * harness that declares every focused control except the MCP exclusion, so a
 * focused run against it is refused for exactly one named reason while a legacy
 * run against the very same driver still drafts.
 *
 * The driver itself is an ordinary working author: if the preflight ever lets a
 * focused run through, the failure is the missing refusal rather than a stub
 * that could not write.
 */
const setupIncapableHarness = ({ name }: { name: string }) => {
	const cwd = setupConsumerRepo();

	seedPlanWorkspace({ cwd, name });

	const invocations: DriverInvocation[] = [];
	const driver: Driver = {
		...createDraftDriver({ bodies: [cleanPlanBody()], onInvoke: (invocation) => invocations.push(invocation) }),
		name: 'omp',
	};

	return { cwd, driver, invocations, planDir: planWorkspaceFolder({ cwd: cwd, name: name }) };
};

/**
 * A plan folder held by the primary checkout, with a linked worktree cut from
 * it — the shape a drafting session runs in once `plan.worktree` moves it into
 * a tree, and the one place a drafted plan could be written somewhere that is
 * removed after shipping.
 *
 * The driver is an ordinary working author, so a run that lands in the wrong
 * checkout fails on the path rather than on a stub that could not write.
 */
const setupDraftFromWorktree = ({ name }: { name: string }) => {
	const primary = setupConsumerRepo();
	const worktree = join(primary, '.worktrees', name);

	seedPlanWorkspace({ cwd: primary, name });
	execSync(`git worktree add -q -b ${name} "${worktree}" HEAD`, { cwd: primary, stdio: 'ignore' });

	return {
		driver: createDraftDriver({ bodies: [cleanPlanBody()] }),
		// realpath on the primary because git answers the resolved path, and macOS
		// puts every temp directory behind a symlink
		primaryPlanDir: planWorkspaceFolder({ cwd: realpathSync(primary), name }),
		worktree,
	};
};

describe('runPlanDraft', () => {
	test('refuses before any spawn when the harness cannot provide a requested control', async () => {
		const { cwd, driver, invocations, planDir } = setupIncapableHarness({ name: 'no-mcp-control' });

		const result = await runPlanDraft({ cwd, driver, name: 'no-mcp-control' });

		expectStatus(result, 'failed');
		// the refusal names the control this harness cannot express
		expect(result.error).toMatch(/mcp/i);
		// nothing was spawned — the whole point is refusing before the spend
		expect(invocations).toStrictEqual([]);
		// and nothing was read for evidence either, which walks and reads the repo
		expect(existsSync(await sourceEvidencePath({ cwd, name: 'no-mcp-control' }))).toBeFalsy();
		// the run never reached a draft flow, so no deliverable was written
		expect(existsSync(join(planDir, 'plan.md'))).toBeFalsy();
	});

	test('skips the environment preflight for a legacy draft', async () => {
		const { cwd, driver, planDir } = setupIncapableHarness({ name: 'legacy-on-omp' });

		const result = await runPlanDraft({ cwd, driver, name: 'legacy-on-omp', implementation: DraftImplementation.Legacy });

		// the same harness the focused preflight refuses drafts normally under
		// legacy — which is what makes the flag a usable escape rather than advice
		expectStatus(result, 'complete');
		expect(result.planPaths).toStrictEqual([join(planDir, 'plan.md')]);
	});

	test('a draft run from a linked worktree writes the deliverable and the evidence record into the primary checkout', async () => {
		const { driver, primaryPlanDir, worktree } = setupDraftFromWorktree({ name: 'drafted-from-a-worktree' });

		const result = await runPlanDraft({ cwd: worktree, driver, name: 'drafted-from-a-worktree' });

		expectStatus(result, 'complete');
		// the verified deliverable is the primary checkout's copy, not the tree's
		expect(result.planPaths).toStrictEqual([join(primaryPlanDir, 'plan.md')]);
		// the collected evidence lands beside it, where a grade run from any other
		// checkout reads it
		expect(existsSync(join(primaryPlanDir, 'source-evidence.json'))).toBeTruthy();
		// and the tree itself holds no plan data at all, so removing it takes nothing
		expect(existsSync(join(worktree, '.lightsout', 'tickets'))).toBeFalsy();
	});
});
