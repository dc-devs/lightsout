import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { type LightsoutConfig, RunStatus } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { pathExists, planWorkspaceDir, restorePlanWorkspace } from '#src/plan/index.ts';
import { QueueWorker } from '#src/queue/common/constants/QueueWorker.ts';
import type { QuestionRelay } from '#src/queue/common/types/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { RunnableTicket } from '#src/queue/common/types/RunnableTicket.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runAutoPlanWorker } from '#src/queue/runAutoPlanWorker.ts';
import { runPlanFolderPipeline } from '#src/queue/runPlanFolderPipeline.ts';
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

	return runPlanFolderPipeline({ cwd, name: branch, config, driver, onProgress });
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
			[QueueWorker.AutoPlan]: () => runAutoPlanWorker({ cwd: worktreePath, ticket, branch, config, driver, settings, answeredQuestion, onProgress }),
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
