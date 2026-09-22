import { buildQueueAutoPlanInvocation } from '#src/agents/index.ts';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { type LightsoutConfig, type WorkOrderState, WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { buildWorkOrderPlans } from '#src/queue/workers/buildWorkOrderPlans.ts';
import { chooseAutoPlanTarget } from '#src/queue/workers/chooseAutoPlanTarget.ts';
import { pullWorkOrderState } from '#src/workOrder/index.ts';

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
	workOrderRunDir: string;
	/** The answer to a question this worker asked, folded back in on re-invocation. */
	answeredQuestion?: AnsweredQuestion;
	onProgress?: (message: string) => void;
}

/**
 * The planning session itself: one headless run of the auto-plan skill on the
 * plan the engine chose.
 *
 * @returns the outcome the worker stops on, or undefined once the plan is written and its folder is on disk
 */
const runPlanningSession = async ({
	cwd,
	ticket,
	planAddress,
	config,
	driver,
	settings,
	answeredQuestion,
	onProgress,
}: {
	cwd: string;
	ticket: TicketSummary;
	planAddress: string;
	config: LightsoutConfig;
	driver: Driver;
	settings: QueueSettings;
	answeredQuestion?: AnsweredQuestion;
	onProgress?: (message: string) => void;
}) => {
	// Under `write` permissions a harness only runs granted prefixes — so the
	// engine grants itself, and the prompt is told the same words verbatim.
	const engineCli = `node ${process.argv[1]}`;
	const outcome = await invokeAgentWithContract({
		driver,
		cwd,
		invocation: buildQueueAutoPlanInvocation({
			ticketRef: ticket.identifier,
			ticketTitle: ticket.title,
			ticketBody: ticket.description,
			engineCli,
			planAddress,
			answeredQuestion,
		}),
		contract: WorkReport,
		model: config.model,
		effort: config.effort,
		permissions: config.permissions,
		timeoutMs: settings.workerTimeoutMs,
		allowedCommands: [...(config['agent-commands'] ?? []), engineCli],
	});

	if (!outcome.ok) {
		return { error: outcome.failure };
	}

	const report: WorkReport = outcome.report;
	const refusal = report.failures[0] ?? report.summary;

	if (report.status === WorkReportStatus.TerminatedAmbiguity) {
		return { question: refusal };
	}

	if (report.status !== WorkReportStatus.Complete) {
		return { error: refusal };
	}

	const folder = await planWorkspaceDir({ cwd, name: planAddress });

	if (!(await pathExists({ path: folder }))) {
		return { error: `${ticket.identifier}'s auto-plan session reported a finished plan, but no plan folder exists at ${folder} — nothing was built` };
	}

	onProgress?.(`${ticket.identifier} is planned and published; the engine now runs the implement pipeline on its plan folder`);

	return undefined;
};

/**
 * The auto-plan worker: one headless session plans the ticket, and the engine
 * builds what it wrote.
 *
 * The engine, not the session, chooses which plan is planned: the lowest plan of
 * the ticket still being planned, or a new plan 001 when the ticket has no plans
 * yet. The session is handed that plan's address and told to plan exactly it, so
 * no name is ever derived twice.
 *
 * The session's job ends when the plan is written, graded and published — then
 * it stops, and the queue builds the work order's plans that are ready to implement
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
	settings,
	env,
	workOrderRunDir,
	answeredQuestion,
	onProgress,
}: Params): Promise<WorkerOutcome> => {
	const chosen = await chooseAutoPlanTarget({ cwd, branch, ticket, config, env, onProgress });

	if ('error' in chosen) {
		return { error: chosen.error };
	}

	const build = ({ record }: { record: WorkOrderState }) =>
		buildWorkOrderPlans({ cwd, branch, ticket, record, config, env, driver, driverName, workOrderRunDir, allowTicketBodyBuild: false, onProgress });

	if (chosen.address === undefined) {
		// No session is spent on a ticket with nothing waiting to be planned: a plan
		// already ready to implement is still built, and an eligible ticket still
		// reaches the ship lane.
		const built = await build({ record: chosen.record });

		return built.open === undefined ? built : { open: `no plan is waiting to be planned on ${ticket.identifier}: ${built.open}` };
	}

	const planAddress = chosen.address;
	const stopped = await runPlanningSession({ cwd, ticket, planAddress, config, driver, settings, answeredQuestion, onProgress });

	if (stopped !== undefined) {
		return stopped;
	}

	// Read again rather than reused: publishing the plan moved it from still being
	// planned to ready to implement, and the build loop reads that progress.
	const planned = await pullWorkOrderState({ cwd, name: branch, config, env, onProgress });

	if ('error' in planned) {
		return { error: planned.error };
	}

	if (planned.record === undefined) {
		return { error: `ticket ${branch} no longer has a record, so the plan ${planAddress} the session wrote could not be built` };
	}

	return build({ record: planned.record });
};
