import { buildQueueAutoPlanInvocation } from '#src/agents/index.ts';
import type { AnsweredQuestion } from '#src/common/types/AnsweredQuestion.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import { type LightsoutConfig, RunStatus, WorkReport, WorkReportStatus } from '#src/contracts/index.ts';
import { runDirectWork } from '#src/direct/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { invokeAgentWithContract } from '#src/invoke/index.ts';
import { QueueRoute } from '#src/queue/common/constants/QueueRoute.ts';
import type { QuestionRelay } from '#src/queue/common/services/QuestionRelay.ts';
import type { QueueSettings } from '#src/queue/common/types/QueueSettings.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';

interface Params {
	/** The worktree this ticket is built in. */
	worktreePath: string;
	settings: QueueSettings;
	ticket: TicketSummary;
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
		timeoutMs: settings.workerMinutes * 60_000,
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
 * The worker, run until it stops asking: every question goes to the one
 * terminal and comes back as an answer the next invocation carries.
 *
 * A worker still asking after the last turn parks, and so does a relay with no
 * terminal behind it — one ticket that cannot be answered must never take the
 * other in-flight workers down with it.
 */
export const runWorkerWithRelay = async ({
	worktreePath,
	ticket,
	config,
	driver,
	driverName,
	settings,
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
		const outcome =
			ticket.route === QueueRoute.Direct
				? await runDirectWorker({ cwd: worktreePath, ticket, config, driver, driverName, answeredQuestion, onProgress })
				: await runAutoPlanWorker({ cwd: worktreePath, ticket, config, driver, settings, answeredQuestion });

		if (outcome.question === undefined) {
			return outcome;
		}

		if (turn === maxRelayedQuestions) {
			return { error: `the worker is still asking after ${turn} answered question(s): ${outcome.question}` };
		}

		const answer = await relay.ask({ question: outcome.question, ticket, coordinatorRunId, coordinatorRunDir }).catch((error: unknown) => ({ error }));

		if (typeof answer !== 'string') {
			return { error: `the worker asked a question that could not be relayed: ${messageOf({ error: answer.error })}` };
		}

		answeredQuestion = { question: outcome.question, answer };
	}
};
