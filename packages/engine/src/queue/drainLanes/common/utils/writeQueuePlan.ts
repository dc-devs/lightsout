import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NamedWorkOrder } from '#src/queue/common/types/NamedWorkOrder.ts';
import { resolveWorktreesRoot } from '#src/worktree/index.ts';

interface Params {
	/** Where the document is written. */
	path: string;
	/** Any checkout of the repository; the worktrees root is derived from its primary. */
	cwd: string;
	/** Every work order admitted so far, in admission order. */
	queued: NamedWorkOrder[];
}

/**
 * The coordinator run's document: one line per admitted work order, naming the
 * worker, the branch its record stores and the worktree a human can reach it in.
 *
 * Both the branch and the worktree come off the entry rather than from the
 * queue's branch template, so the document names the branch the drain will
 * actually build on and the directory it will actually build in.
 *
 * Rewritten in full every time a scan admits work, because work orders now join
 * a run already in flight rather than arriving one wave at a time.
 */
export const writeQueuePlan = async ({ path, cwd, queued }: Params): Promise<void> => {
	const root = await resolveWorktreesRoot({ cwd });
	const lines = queued.map(
		(workOrder) => `- ${workOrder.ticket.identifier} · ${workOrder.ticket.worker} · ${workOrder.branch} · ${join(root, workOrder.name)}`,
	);

	await writeFile(path, `# queue drain\n\n${lines.join('\n')}\n`, 'utf8');
};
