import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { planningCommandRuntime } from '#src/cli/plan/common/utils/planningCommandRuntime.ts';
import { printPlanningRunResult } from '#src/cli/plan/common/utils/printPlanningRunResult.ts';
import { PlanningInput } from '#src/contracts/index.ts';
import { capturePlanningInput, runPlanning } from '#src/plan/index.ts';

/** Capture optional full input, then continue the engine-owned planning obligations to their next real boundary. */
export const planRunCommand = async ({ cwd, flags }: CommandContext): Promise<void> => {
	const runtime = await planningCommandRuntime({ cwd, flags });
	if (flags.has('input-file')) {
		const path = await getRequiredFlag({ flags, name: 'input-file' });
		const input = PlanningInput.parse(JSON.parse(await readFile(resolve(cwd, path), 'utf8')));
		await capturePlanningInput({ runtime, input });
	}
	const result = await runPlanning({ runtime });
	await printPlanningRunResult({ result });
};
