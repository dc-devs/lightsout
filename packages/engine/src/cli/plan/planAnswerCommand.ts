import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { planningCommandRuntime } from '#src/cli/plan/common/utils/planningCommandRuntime.ts';
import { printPlanningRunResult } from '#src/cli/plan/common/utils/printPlanningRunResult.ts';
import { PlanningAnswer } from '#src/contracts/index.ts';
import { answerPlanningQuestion } from '#src/plan/index.ts';

/** Resume only an explicit answer carrying the exact durable question identity and foreground provenance. */
export const planAnswerCommand = async ({ cwd, flags }: CommandContext): Promise<void> => {
	const path = await getRequiredFlag({ flags, name: 'answer-file' });
	const answer = PlanningAnswer.parse(JSON.parse(await readFile(resolve(cwd, path), 'utf8')));
	const runtime = await planningCommandRuntime({ cwd, flags });
	const result = await answerPlanningQuestion({ runtime, answer });
	await printPlanningRunResult({ result });
};
