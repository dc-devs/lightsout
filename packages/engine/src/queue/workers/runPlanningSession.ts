import { resolveCommandHarness } from '#src/common/config/resolveCommandHarness.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type LightsoutConfig, type PlanningAnswer, PlanningVocabulary } from '#src/contracts/index.ts';
import { type Driver, getDriver } from '#src/drivers/index.ts';
import { answerPlanningQuestion, capturePlanningInput, createPlanningRuntime, ensurePlanningInput, PlanningMode, runPlanning } from '#src/plan/index.ts';
import type { TicketSummary } from '#src/queue/common/types/TicketSummary.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { restorePlanningSession } from '#src/queue/workers/restorePlanningSession.ts';
import { publishTicketPlan } from '#src/ticket/index.ts';

interface Params {
	cwd: string;
	ticket: TicketSummary;
	planAddress: string;
	expectedMarker?: string;
	config: LightsoutConfig;
	driver: Driver;
	env: NodeJS.ProcessEnv;
	planningAnswer?: PlanningAnswer;
	onProgress?: (message: string) => void;
}

/** The queue calls the planner directly; publication completes before it may hand the plan to its build owner. */
export const runPlanningSession = async ({
	cwd,
	ticket,
	planAddress,
	expectedMarker,
	config,
	driver,
	env,
	planningAnswer,
	onProgress,
}: Params): Promise<WorkerOutcome | undefined> => {
	await restorePlanningSession({ cwd, planAddress, identifier: ticket.identifier, config, env, expectedMarker, onProgress });
	const execution = resolveCommandHarness({ config, command: 'plan' });
	const runtime = await createPlanningRuntime({
		cwd,
		name: planAddress,
		config,
		driver: driver.name === execution.driverName ? driver : getDriver({ name: execution.driverName }),
		mode: PlanningMode.Automatic,
		stage: PlanningVocabulary.Stage.Implementation,
		onProgress,
	});
	await ensurePlanningInput({ runtime });
	{
		const text = `${ticket.title}\n\n${ticket.description}`;
		await capturePlanningInput({
			runtime,
			input: {
				stage: runtime.stage,
				sources: [{ artifact: 'ticket-body.txt', locator: `${ticket.identifier} complete title and description`, text, sha256: sha256({ content: text }) }],
				claims: [],
				confirmations: [],
			},
		});
	}
	const result = planningAnswer ? await answerPlanningQuestion({ runtime, answer: planningAnswer }) : await runPlanning({ runtime });
	let stopped: WorkerOutcome | undefined;
	if (result.status === PlanningVocabulary.Status.AwaitingUser) {
		const options = result.question.options.map((option) => `${option.label}: ${option.description}`).join('\n');
		stopped = {
			question: `${result.question.context}\n${result.question.question}\n${options}\nReply with the exact option label or describe the requested change.`,
			planningQuestion: result,
		};
	} else if (result.status !== PlanningVocabulary.Status.Complete) {
		stopped = {
			error:
				result.status === PlanningVocabulary.Status.ExternallyBlocked ? `${result.cause} ${result.continuation}` : 'Implementation planning has not completed.',
		};
	} else {
		const published = await publishTicketPlan({
			cwd,
			address: planAddress,
			expectedGeneration: result.generation,
			config,
			env,
			onProgress: onProgress ?? (() => {}),
		});
		if (published.error || published.recordError) stopped = { error: published.error ?? published.recordError };
		else if (config['auto-plan']?.['implement-on-approval'] === false)
			stopped = { open: 'Planning is complete and published; automatic implementation is disabled.' };
		else onProgress?.(`${ticket.identifier} is planned and published; the queue now runs the implement pipeline on its plan folder`);
	}
	return stopped;
};
