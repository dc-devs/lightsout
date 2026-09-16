import { exitCli } from '#src/cli/common/utils/exitCli.ts';
import { PlanningRunResult, PlanningVocabulary } from '#src/contracts/index.ts';

interface Params {
	result: PlanningRunResult;
}

/** Print the durable continuation/checkpoint identity; readiness never starts implementation here. */
export const printPlanningRunResult = async ({ result: proposed }: Params): Promise<never> => {
	const result = PlanningRunResult.parse(proposed);
	console.log(JSON.stringify(result, null, 2));
	if (result.status === PlanningVocabulary.Status.Aligned) console.error('ready-auto-plan');
	const code = result.status === PlanningVocabulary.Status.AwaitingUser ? 2 : result.status === PlanningVocabulary.Status.ExternallyBlocked ? 1 : 0;
	return exitCli({ code });
};
