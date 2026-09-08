import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, test } from '@jest/globals';
import { writeQueuePlan } from '#src/queue/drainLanes/common/utils/writeQueuePlan.ts';
import { queueTicketFixture } from '#tests/helpers/queueTicketFixture.ts';
import { setupDrainLaneState } from '#tests/helpers/setupDrainLaneState.ts';

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
});
