import { execSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { resolvePlanWorkingCheckout } from '#src/ticket/divergence/resolvePlanWorkingCheckout.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';

/** The ticket folder's name, which is also the branch its worktree stands on. */
const ticketBranch = 'lo-150-planning-observability';
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
	const worktree = join(dirname(primary), `${basename(primary)}-worktrees`, ticketBranch);

	execSync(`git worktree add -q -b ${ticketBranch} "${worktree}" main`, { cwd: primary, stdio: 'ignore' });
	mkdirSync(join(primary, '.lightsout', 'tickets', ticketBranch, 'plans', planId), { recursive: true });
	mkdirSync(join(worktree, '.lightsout', 'tickets', ticketBranch, 'plans', planId), { recursive: true });

	return { primary, worktree };
};

describe('resolvePlanWorkingCheckout', () => {
	test('the primary checkout always holds the publishable copy, with no other copies to report', async () => {
		const { primary } = setupTicketWorktree();

		const working = await resolvePlanWorkingCheckout({ cwd: primary, ticketBranch, planId });

		expect({ checkout: realpathSync(working.checkout), otherCopies: working.otherCopies }).toStrictEqual({
			checkout: primary,
			otherCopies: [],
		});
	});
});
