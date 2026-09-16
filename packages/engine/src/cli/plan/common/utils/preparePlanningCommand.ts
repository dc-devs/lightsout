import type { LightsoutConfig } from '#src/contracts/index.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { createPlanningRuntime, ensurePlanningInput, PlanningMode, type PlanningRuntime } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	name: string;
	driver: Driver;
	config: LightsoutConfig | undefined;
}

/** Compatibility command names enter the same production policy and preserve full legacy originals. */
export const preparePlanningCommand = async ({ cwd, name, driver, config }: Params): Promise<PlanningRuntime> => {
	if (!config) throw new Error('Planning requires lightsout.config.json');
	const runtime = await createPlanningRuntime({
		cwd,
		name,
		driver,
		config,
		mode: PlanningMode.Interactive,
		stage: PlanningVocabulary.Stage.Implementation,
		onProgress: (message) => console.error(message),
	});
	await ensurePlanningInput({ runtime });
	return runtime;
};
