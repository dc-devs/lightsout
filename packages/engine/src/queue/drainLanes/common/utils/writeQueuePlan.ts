import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import { toTicketBranch } from '#src/queue/toTicketBranch.ts';
import { resolveWorktreesRoot } from '#src/worktree/index.ts';

interface Params {
	/** Where the document is written. */
	path: string;
	/** Any checkout of the repository; the worktrees root is derived from its primary. */
	cwd: string;
	settings: QueueSettings;
	/** Every ticket admitted so far, in admission order. */
	queued: RunnableTicket[];
}

/**
 * The coordinator run's document: one line per admitted ticket, naming the
 * worker, the branch and the worktree a human can reach it in.
 *
 * Rewritten in full every time a scan admits tickets, because tickets now join
 * a run already in flight rather than arriving one wave at a time.
 */
export const writeQueuePlan = async ({ path, cwd, settings, queued }: Params): Promise<void> => {
	const root = await resolveWorktreesRoot({ cwd });
	const lines = queued.map((ticket) => {
		const branch = toTicketBranch({ ticket, template: settings.branchTemplate });

		return `- ${ticket.identifier} · ${ticket.worker} · ${branch} · ${join(root, branch)}`;
	});

	await writeFile(path, `# queue drain\n\n${lines.join('\n')}\n`, 'utf8');
};
