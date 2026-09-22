import { type LightsoutConfig, WorkOrderEventKind } from '#src/contracts/index.ts';
import { appendTicketEvent } from '#src/ticket/common/record/appendTicketEvent.ts';
import { changeExistingTicketRecord } from '#src/ticket/common/record/changeExistingTicketRecord.ts';
import { resolveTicketPlan } from '#src/ticket/common/record/resolveTicketPlan.ts';
import type { TicketRecordChange } from '#src/ticket/common/types/TicketRecordChange.ts';

interface Params {
	/** Any checkout of the repository: the one record this machine holds is found from it. */
	cwd: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
	/** A full plan id, or the plan's number on its own. */
	plan: string;
	title: string;
	config: LightsoutConfig;
	/** The process environment the tracker API key is read from. */
	env: NodeJS.ProcessEnv;
	onProgress?: (message: string) => void;
}

/**
 * Change what a plan is called, and nothing else.
 *
 * The id, the plan's folder, its published attachments and any pending ship
 * request are all left exactly as they were — that separation is the whole
 * point of a plan having a mutable title beside a fixed identity, and it is
 * what makes renaming a plan something that never withdraws an approval.
 */
export const retitleTicketPlan = ({ cwd, ticketBranch, plan, title, config, env, onProgress }: Params): Promise<TicketRecordChange | { error: string }> =>
	changeExistingTicketRecord({
		cwd,
		ticketBranch,
		config,
		env,
		onProgress,
		change: (record) => {
			if (title.trim() === '') {
				return { error: `a plan's display title is what a human recognises it by, so it cannot be blank` };
			}

			const target = resolveTicketPlan({ record, token: plan });

			if ('error' in target) {
				return target;
			}

			return appendTicketEvent({
				record: { ...record, plans: record.plans.map((candidate) => (candidate.id === target.id ? { ...candidate, title } : candidate)) },
				kind: WorkOrderEventKind.PlanRetitled,
				detail: `plan ${target.id} on ticket ${ticketBranch} is now titled '${title}'`,
				at: new Date().toISOString(),
			});
		},
	});
