import { join } from 'node:path';
import { buildQueueAutoPlanInvocation } from '#src/agents/index.ts';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { type LightsoutConfig, RunStatus, WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { runPhasesPipeline } from '#src/phases/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { pathExists, planWorkspaceDir, restorePlanWorkspace } from '#src/plan/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import type { TrackerSettings } from '#src/ticketTracker/index.ts';

interface Params {
	/** The worktree this ticket is built in. */
	worktreePath: string;
	/** The ticket's branch, which is also the name of its plan folder. */
	branch: string;
	settings: QueueSettings;
	trackerSettings: TrackerSettings;
	ticket: RunnableTicket;
	config: LightsoutConfig;
	driver: Driver;
	driverName: string;
	relay: QuestionRelay;
	/** The coordinator run's id, stamped on every relayed question and answer. */
	coordinatorRunId: string;
	/** The coordinator run's directory in the main checkout, where the relay records them. */
	coordinatorRunDir: string;
	onProgress?: (message: string) => void;
}

/** The headless auto-plan session: plan the ticket with the skill, then run the engine's implement on the plan it wrote. */
const runAutoPlanWorker = async ({
	cwd,
	ticket,
	config,
	driver,
	settings,
	answeredQuestion,
}: {
	cwd: string;
	ticket: TicketSummary;
	config: LightsoutConfig;
	driver: Driver;
	settings: QueueSettings;
	answeredQuestion?: AnsweredQuestion;
}): Promise<WorkerOutcome> => {
	// The skill shells out to `lightsout implement`, and under `write`
	// permissions a harness only runs granted prefixes — so the engine grants
	// itself, and the prompt is told the same words verbatim.
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

	return report.status === WorkReportStatus.Complete ? {} : { error: refusal };
};

/** The direct worker, its run result read back in the same three terms. */
const runDirectWorker = async ({
	cwd,
	ticket,
	config,
	driver,
	driverName,
	answeredQuestion,
	onProgress,
}: {
	cwd: string;
	ticket: TicketSummary;
	config: LightsoutConfig;
	driver: Driver;
	driverName: string;
	answeredQuestion?: AnsweredQuestion;
	onProgress?: (message: string) => void;
}): Promise<WorkerOutcome> => {
	const result = await runDirectWork({
		cwd,
		ticketBody: ticket.description,
		ticketRef: ticket.identifier,
		driver,
		driverName,
		config,
		answeredQuestion,
		onProgress,
	});

	if (result.ok) {
		return {};
	}

	const stated = result.error ?? `the run ended ${result.manifest.status}`;

	return result.manifest.status === RunStatus.Escalated ? { question: stated } : { error: stated };
};

/**
 * The plan worker: implement the plan the ticket already carries.
 *
 * The plan folder is named exactly like the branch, and `.lightsout` is
 * gitignored, so a fresh worktree has none — the ordinary case is fetching it
 * back from the ticket's own attachments.
 *
 * A ticket carrying no plan at all is not an error: shaping may have finished on
 * approved brainstorm material, whose outcome lives in the ticket body. It then
 * builds from the body, announced so the run is legible — and stays distinct
 * from the direct worker, which never looks for a plan at all.
 *
 * It never relays a question. The implement pipelines take an existing manifest
 * and have no answer channel, so a question relayed out of here could never be
 * answered back into the run that asked it; an escalated run parks with its
 * worktree intact instead, the engine's existing recovery path for one.
 */
const runPlanWorker = async ({
	cwd,
	ticket,
	branch,
	config,
	driver,
	driverName,
	trackerSettings,
	onProgress,
}: {
	cwd: string;
	ticket: TicketSummary;
	branch: string;
	config: LightsoutConfig;
	driver: Driver;
	driverName: string;
	trackerSettings: TrackerSettings;
	onProgress?: (message: string) => void;
}): Promise<WorkerOutcome> => {
	const folder = planWorkspaceDir({ cwd, name: branch });

	if (!(await pathExists({ path: folder }))) {
		const restored = await restorePlanWorkspace({ cwd, name: branch, identifier: ticket.identifier, settings: trackerSettings });

		if (restored.error !== undefined) {
			return { error: `the plan published to ${ticket.identifier} could not be fetched: ${restored.error}` };
		}

		if (restored.restored.length === 0) {
			onProgress?.(`${ticket.identifier} carries no published plan, so it is built from the ticket body`);

			return runDirectWorker({ cwd, ticket, config, driver, driverName, onProgress });
		}
	}

	const phased = await pathExists({ path: join(folder, 'overview.md') });
	const result = phased
		? await runPhasesPipeline({ cwd, driver, config, overviewPath: join(folder, 'overview.md'), onProgress })
		: await runImplementPipeline({ cwd, driver, config, planPath: join(folder, 'plan.md'), onProgress });

	if (result.ok) {
		return {};
	}

	const stated = result.error ?? `the run ended ${result.manifest.status}`;

	return { error: `${stated} — \`lightsout resume --run ${result.manifest.runId}\` continues it from the worktree` };
};

/**
 * The worker, run until it stops asking: every question goes to the one
 * terminal and comes back as an answer the next invocation carries.
 *
 * A worker still asking after the last turn parks, and so does a relay with no
 * terminal behind it — one ticket that cannot be answered must never take the
 * other in-flight workers down with it.
 */
export const runWorkerWithRelay = async ({
	worktreePath,
	branch,
	ticket,
	config,
	driver,
	driverName,
	settings,
	trackerSettings,
	relay,
	coordinatorRunId,
	coordinatorRunDir,
	onProgress,
}: Params): Promise<WorkerOutcome> => {
	// The relay's own policy, deliberately its own number rather than the
	// gate-fix retry count it happens to equal: tuning how many times a red gate
	// is retried must never silently change how many times the user is asked.
	const maxRelayedQuestions = 2;
	let answeredQuestion: AnsweredQuestion | undefined;

	for (let turn = 0; ; turn += 1) {
		const workers: Record<QueueWorker, () => Promise<WorkerOutcome>> = {
			[QueueWorker.Direct]: () => runDirectWorker({ cwd: worktreePath, ticket, config, driver, driverName, answeredQuestion, onProgress }),
			[QueueWorker.Plan]: () => runPlanWorker({ cwd: worktreePath, ticket, branch, config, driver, driverName, trackerSettings, onProgress }),
			[QueueWorker.AutoPlan]: () => runAutoPlanWorker({ cwd: worktreePath, ticket, config, driver, settings, answeredQuestion }),
		};
		const outcome = await workers[ticket.worker]();

		if (outcome.question === undefined) {
			return outcome;
		}

		if (turn === maxRelayedQuestions) {
			return { error: `the worker is still asking after ${turn} answered question(s): ${outcome.question}` };
		}

		const answer = await relay.ask({ question: outcome.question, ticket, coordinatorRunId, coordinatorRunDir }).catch((error: unknown) => ({ error }));

		if (typeof answer !== 'string') {
			// `unanswered` marks the one park that means the human is away — the
			// relay throws only when a question can never be answered, and the
			// drain reads the flag to stop taking on work nobody is there to steer.
			return { error: `the worker asked a question that could not be relayed: ${messageOf({ error: answer.error })}`, unanswered: true };
		}

		answeredQuestion = { question: outcome.question, answer };
	}
};
