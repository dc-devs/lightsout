import { renderBranchTemplate } from '#src/common/utils/renderBranchTemplate.ts';
import type { nameWaveWorkOrders } from '#src/queue/nameWaveWorkOrders.ts';

/**
 * A stand-in for the drain's naming step that labels every ticket the way the
 * queue's branch template renders it.
 *
 * Creating a work order is the work order module's own job, with its own tests,
 * and it reads a tracker and spawns a harness — neither of which a drain test
 * arranges. Naming each entry from the template keeps the branch and worktree
 * names those tests already state, so what they pin stays about the drain.
 *
 * The template is rendered through the shared renderer rather than through the
 * queue's own `renderWorkOrderBranch`, which is an internal of that module: a
 * helper outside it may only reach the queue through its barrel.
 */
export const nameWaveLikeTemplate =
	({ template = '{ticket}-{slug}' }: { template?: string } = {}) =>
	async ({ tickets }: Parameters<typeof nameWaveWorkOrders>[0]): ReturnType<typeof nameWaveWorkOrders> => ({
		named: tickets.map((ticket) => {
			const name = renderBranchTemplate({ template, ticketRef: ticket.identifier, title: ticket.title });

			return { ticket, name, branch: name };
		}),
		leftBehind: [],
	});
