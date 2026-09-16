import { z } from 'zod';
import { getRequiredFlag } from '#src/cli/common/args/getRequiredFlag.ts';
import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import type { CommandContext } from '#src/cli/common/types/CommandContext.ts';
import { resolveConfigAndDriver } from '#src/cli/common/utils/resolveConfigAndDriver.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import { createPlanningRuntime, PlanningMode, type PlanningRuntime } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	flags: CommandContext['flags'];
}

/** Both direct planning entries resolve the same configured provider and explicit interaction/stage options. */
export const planningCommandRuntime = async ({ cwd, flags }: Params): Promise<PlanningRuntime> => {
	const name = await getRequiredFlag({ flags, name: 'name' });
	const stage = z.enum(PlanningVocabulary.Stage).parse(getStringFlag({ flags, name: 'stage' }) ?? PlanningVocabulary.Stage.Implementation);
	const mode = z.enum(PlanningMode).parse(getStringFlag({ flags, name: 'mode' }) ?? PlanningMode.Interactive);
	const { config, driver } = await resolveConfigAndDriver({ cwd, command: 'plan' });
	if (!config) throw new Error('Direct planning requires lightsout.config.json with the repository standards and verification gates');
	return createPlanningRuntime({ cwd, name, config, driver, stage, mode, onProgress: (message) => console.error(message) });
};
