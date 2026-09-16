import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { LightsoutConfig, TicketRecord } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { buildTicketPlans } from '#src/queue/workers/buildTicketPlans.ts';
import { chooseAutoPlanTarget } from '#src/queue/workers/chooseAutoPlanTarget.ts';
import { runPlanningSession } from '#src/queue/workers/runPlanningSession.ts';
import { pullTicketRecord } from '#src/ticket/index.ts';

interface Params {
	/** The worktree the ticket is planned and built in. */
	cwd: string;
	ticket: TicketSummary;
	/** The ticket's branch, which is also the ticket folder the engine chooses a plan inside. */
	branch: string;
	config: LightsoutConfig;
	driver: Driver;
	/** Recorded as the harness name on a build from the ticket body. */
	driverName: string;
	settings: QueueSettings;
	/** The process environment the tracker credentials are read from. */
	env: NodeJS.ProcessEnv;
	/** The ticket's directory under the coordinator run, where each plan's commit message file is written. */
	ticketRunDir: string;
	/** The answer to a question this worker asked, folded back in on re-invocation. */
	answeredQuestion?: AnsweredQuestion;
	onProgress?: (message: string) => void;
}

/**
 * The auto-plan worker: the typed planner plans the ticket, and the engine
 * builds what it wrote.
 *
 * The engine, not the session, chooses which plan is planned: the lowest plan of
 * the ticket still being planned, or a new plan 001 when the ticket has no plans
 * yet. The runtime receives that exact address, so
 * no name is ever derived twice.
 *
 * The session's job ends when the plan is written, graded and published — then
 * it stops, and the queue builds the ticket's plans that are ready to implement
 * in numeric order. A build takes hours, so no build lives inside an agent
 * session that could take it down part-way.
 */
export const runAutoPlanWorker = async ({
	cwd,
	ticket,
	branch,
	config,
	driver,
	driverName,
	env,
	ticketRunDir,
	answeredQuestion,
	onProgress,
}: Params): Promise<WorkerOutcome> => {
	const chosen = await chooseAutoPlanTarget({ cwd, branch, ticket, config, env, onProgress });

	if ('error' in chosen) {
		return { error: chosen.error };
	}

	const build = ({ record }: { record: TicketRecord }): Promise<WorkerOutcome> =>
		config['auto-plan']?.['implement-on-approval'] === false
			? Promise.resolve({ open: 'Automatic implementation is disabled.' })
			: buildTicketPlans({ cwd, branch, ticket, record, config, env, driver, driverName, ticketRunDir, allowTicketBodyBuild: false, onProgress });

	if (chosen.address === undefined) {
		// No session is spent on a ticket with nothing waiting to be planned: a plan
		// already ready to implement is still built, and an eligible ticket still
		// reaches the ship lane.
		const built = await build({ record: chosen.record });

		return built.open === undefined ? built : { open: `no plan is waiting to be planned on ${ticket.identifier}: ${built.open}` };
	}

	const planAddress = chosen.address;
	const stopped = await runPlanningSession({
		cwd,
		ticket,
		planAddress,
		config,
		driver,
		env,
		planningAnswer: answeredQuestion?.planningAnswer,
		expectedMarker: chosen.record.plans.find((plan) => chosen.address?.endsWith(`/${plan.id}`))?.publishedMarker,
		onProgress,
	}).catch((error: unknown) => ({ error: messageOf({ error }) }));

	if (stopped !== undefined) {
		return stopped;
	}

	// Read again rather than reused: publishing the plan moved it from still being
	// planned to ready to implement, and the build loop reads that progress.
	const planned = await pullTicketRecord({ cwd, ticketBranch: branch, config, env, onProgress });

	if ('error' in planned) {
		return { error: planned.error };
	}

	if (planned.record === undefined) {
		return { error: `ticket ${branch} no longer has a record, so the plan ${planAddress} the session wrote could not be built` };
	}

	return build({ record: planned.record });
};
