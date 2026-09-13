import { commitTicketWork } from '#src/queue/commitTicketWork.ts';
import type { TicketPlanStep } from '#src/queue/workers/common/types/TicketPlanStep.ts';

interface Params {
	step: TicketPlanStep;
}

/**
 * One plan's implementation, committed under a message naming the ticket, the
 * plan id and the plan's title.
 *
 * Each plan is committed before the next is taken, so a later plan's
 * implementation can be removed again by its own commit alone.
 *
 * @returns the one sentence saying why nothing was committed, or undefined once it was
 */
export const commitPlanWork = async ({ step }: Params): Promise<string | undefined> => {
	const { cwd, record, plan, ticket, ticketRunDir, config, onProgress } = step;
	const committed = await commitTicketWork({
		cwd,
		message: `${ticket.identifier} ${plan.id}: ${plan.title}`,
		runDir: ticketRunDir,
		generated: config.generated,
		onProgress,
	});

	return 'error' in committed ? `plan ${plan.id} on ticket ${record.branch} was built, but its work could not be committed: ${committed.error}` : undefined;
};
