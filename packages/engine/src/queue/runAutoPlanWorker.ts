import { buildQueueAutoPlanInvocation } from '#src/agents/index.ts';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { type LightsoutConfig, WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runPlanFolderPipeline } from '#src/queue/runPlanFolderPipeline.ts';

interface Params {
	/** The worktree the ticket is planned and built in. */
	cwd: string;
	ticket: TicketSummary;
	/** The ticket's branch, which is also the name of the plan folder its session writes. */
	branch: string;
	config: LightsoutConfig;
	driver: Driver;
	settings: QueueSettings;
	/** The answer to a question this worker asked, folded back in on re-invocation. */
	answeredQuestion?: AnsweredQuestion;
	onProgress?: (message: string) => void;
}

/**
 * The auto-plan worker: one headless session plans the ticket, and the engine
 * builds what it wrote.
 *
 * The session's job ends when the plan is written, graded and published — then
 * it stops, and the queue runs the implement pipeline on the plan folder left
 * in the worktree. A build takes hours, so no build lives inside an agent
 * session that could take it down part-way.
 */
export const runAutoPlanWorker = async ({ cwd, ticket, branch, config, driver, settings, answeredQuestion, onProgress }: Params): Promise<WorkerOutcome> => {
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

	const folder = planWorkspaceDir({ cwd, name: branch });

	if (!(await pathExists({ path: folder }))) {
		return { error: `${ticket.identifier}'s auto-plan session reported a finished plan, but no plan folder exists at ${folder} — nothing was built` };
	}

	onProgress?.(`${ticket.identifier} is planned and published; the engine now runs the implement pipeline on its plan folder`);

	return runPlanFolderPipeline({ cwd, name: branch, config, driver, onProgress });
};
