import { execSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolvePlanWorkingCheckout } from '#src/workOrder/divergence/resolvePlanWorkingCheckout.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** The work order's label, which is also the branch its worktree stands on. */
const name = 'lo-150-planning-observability';
const planId = '001-plan-data-in-main-checkout';

/**
 * A primary checkout with a linked worktree standing at the ticket's branch,
 * and a plan folder inside each of them.
 *
 * The worktree sits where the engine cuts one — a sibling directory beside the
 * primary — and holds a copy of the plan folder, because that pair is exactly
 * what used to make the worktree's copy the one publishing would send.
 */
const setupTicketWorktree = () => {
	const { cwd } = setupBranchRepo();
	const primary = realpathSync(cwd);
	const worktree = join(dirname(primary), `${basename(primary)}-worktrees`, name);

	execSync(`git worktree add -q -b ${name} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	mkdirSync(join(primary, '.lightsout', 'tickets', name, 'plans', planId), { recursive: true });
	mkdirSync(join(worktree, '.lightsout', 'tickets', name, 'plans', planId), { recursive: true });

	return { primary, worktree };
};

describe('resolvePlanWorkingCheckout', () => {
	test('the primary checkout always holds the publishable copy, with no other copies to report', async () => {
		const { primary } = setupTicketWorktree();

		const working = await resolvePlanWorkingCheckout({ cwd: primary, name, planId });

		expect({ checkout: realpathSync(working.checkout), otherCopies: working.otherCopies }).toStrictEqual({
			checkout: primary,
			otherCopies: [],
		});
	});
});
