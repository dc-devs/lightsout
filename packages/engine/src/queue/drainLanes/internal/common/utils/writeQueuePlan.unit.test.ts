import { execSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import { writeQueuePlan } from '#src/queue/drainLanes/internal/common/utils/writeQueuePlan.ts';
import { namedWorkOrderFixture } from '#tests/helpers/namedWorkOrderFixture.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupBranchRepo } from '#tests/helpers/setupBranchRepo.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

/**
 * A coordinator launched from a linked worktree rather than the checkout the
 * repository was cloned into — the shape that tells a primary-rooted worktrees
 * path apart from one derived from whatever directory the command was run in.
 */
const setupLaunchedFromLinkedWorktree = () => {
	const { cwd: primary } = setupBranchRepo();
	const worktree = join(primary, '.worktrees', 'lo-131-linked');

	execSync(`git worktree add -q -b lo-131-linked "${worktree}" main`, { cwd: primary, stdio: 'ignore' });

	return { primary, cwd: worktree, planPath: join(worktree, 'queue.md') };
};

/** One admitted work order whose record stores the plain `<ticket>-work` branch its label also spells. */
const workOrderOf = ({ number }: { number: number }) => {
	const ticket = queueTicketFixture({ number });

	return namedWorkOrderFixture({ ticket, name: `${ticket.identifier.toLowerCase()}-work` });
};

/**
 * Two admitted work orders whose records store prefixed branches, so a branch
 * read off the record reads differently from one a template would render, and a
 * worktree named by the work order's label reads differently from one named by
 * its branch.
 */
const setupPrefixedWorkOrders = () => {
	const { context } = setupDrainLaneState();
	const queued: NamedWorkOrder[] = [
		{ ticket: queueTicketFixture({ number: 8 }), name: 'lo-8-alpha', branch: 'feature/lo-8-alpha' },
		{ ticket: queueTicketFixture({ number: 9 }), name: 'lo-9-beta', branch: 'team/lo-9-beta' },
	];

	return {
		cwd: context.cwd,
		planPath: context.planPath,
		queued,
		root: join(dirname(context.cwd), `${basename(context.cwd)}-worktrees`),
	};
};

describe('writeQueuePlan', () => {
	test('rewrites the complete admitted list with the stored branches and sibling worktree paths', async () => {
		const { context } = setupDrainLaneState();
		const params = { path: context.planPath, cwd: context.cwd };

		await writeQueuePlan({ ...params, queued: [workOrderOf({ number: 99 })] });
		await writeQueuePlan({ ...params, queued: [workOrderOf({ number: 2 }), workOrderOf({ number: 1 })] });

		const root = join(dirname(context.cwd), `${basename(context.cwd)}-worktrees`);

		expect(readFileSync(context.planPath, 'utf8')).toBe(
			`# queue drain\n\n- LO-2 · direct · lo-2-work · ${join(root, 'lo-2-work')}\n- LO-1 · direct · lo-1-work · ${join(root, 'lo-1-work')}\n`,
		);
	});

	test("lists every admitted work order's worktree under the primary checkout's sibling root", async () => {
		const { primary, cwd, planPath } = setupLaunchedFromLinkedWorktree();

		await writeQueuePlan({ path: planPath, cwd, queued: [workOrderOf({ number: 4 }), workOrderOf({ number: 5 })] });

		// A temporary directory reaches the test through a symlinked parent while
		// git answers the resolved path, so the expectation is built from the
		// resolved spelling — the one the document carries.
		const root = `${realpathSync(primary)}-worktrees`;
		const document = readFileSync(planPath, 'utf8');

		expect(document).toBe(
			`# queue drain\n\n- LO-4 · direct · lo-4-work · ${join(root, 'lo-4-work')}\n- LO-5 · direct · lo-5-work · ${join(root, 'lo-5-work')}\n`,
		);
	});

	test("lists each work order's stored branch and its worktree", async () => {
		const { cwd, planPath, queued, root } = setupPrefixedWorkOrders();

		await writeQueuePlan({ path: planPath, cwd, queued });

		const document = readFileSync(planPath, 'utf8');

		expect(document).toEqual(expect.stringContaining(`LO-8 · direct · feature/lo-8-alpha · ${join(root, 'lo-8-alpha')}`));
		expect(document).toEqual(expect.stringContaining(`LO-9 · direct · team/lo-9-beta · ${join(root, 'lo-9-beta')}`));
	});
});
