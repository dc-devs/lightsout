import { execSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { writeQueuePlan } from '#src/queue/drainLanes/common/utils/writeQueuePlan.ts';
import { queueSettingsFixture } from '#tests/helpers/queueSettingsFixture.ts';
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

	return {
		primary,
		cwd: worktree,
		planPath: join(worktree, 'queue.md'),
		settings: queueSettingsFixture({ branchTemplate: '{ticket}-work' }),
	};
};

describe('writeQueuePlan', () => {
	test('rewrites the complete admitted list with the configured branches and sibling worktree paths', async () => {
		const { context } = setupDrainLaneState();
		const settings = { ...context.settings, branchTemplate: '{ticket}-work' };
		const params = { path: context.planPath, cwd: context.cwd, settings };

		await writeQueuePlan({ ...params, queued: [queueTicketFixture({ number: 99 })] });
		await writeQueuePlan({ ...params, queued: [queueTicketFixture({ number: 2 }), queueTicketFixture({ number: 1 })] });

		const root = join(dirname(context.cwd), `${basename(context.cwd)}-worktrees`);

		expect(readFileSync(context.planPath, 'utf8')).toBe(
			`# queue drain\n\n- LO-2 · direct · lo-2-work · ${join(root, 'lo-2-work')}\n- LO-1 · direct · lo-1-work · ${join(root, 'lo-1-work')}\n`,
		);
	});

	test("lists every admitted ticket's worktree under the primary checkout's sibling root", async () => {
		const { primary, cwd, planPath, settings } = setupLaunchedFromLinkedWorktree();

		await writeQueuePlan({ path: planPath, cwd, settings, queued: [queueTicketFixture({ number: 4 }), queueTicketFixture({ number: 5 })] });

		// A temporary directory reaches the test through a symlinked parent while
		// git answers the resolved path, so the expectation is built from the
		// resolved spelling — the one the document carries.
		const root = `${realpathSync(primary)}-worktrees`;
		const document = readFileSync(planPath, 'utf8');

		expect(document).toBe(
			`# queue drain\n\n- LO-4 · direct · lo-4-work · ${join(root, 'lo-4-work')}\n- LO-5 · direct · lo-5-work · ${join(root, 'lo-5-work')}\n`,
		);
	});
});
