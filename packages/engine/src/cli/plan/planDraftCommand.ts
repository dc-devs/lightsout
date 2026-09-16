import { getStringFlag } from '#src/cli/common/args/getStringFlag.ts';
import { printPlanningRunResult } from '#src/cli/plan/common/utils/printPlanningRunResult.ts';
import { type LightsoutConfig, PlanningVocabulary, PlanVariant } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { capturePlanningLayout, createPlanningRuntime, ensurePlanningInput, PlanningMode, runPlanning } from '#src/plan/index.ts';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
	flags: Map<string, string | true>;
}

/** Draft is a compatibility command name for the authoritative planner, including its approval and completion obligations. */
export const planDraftCommand = async ({ cwd, driver, name, config, flags }: Params): Promise<void> => {
	if (flags.has('legacy')) throw new Error('--legacy no longer selects an authoring engine; existing legacy artifacts remain readable.');
	const scope = getStringFlag({ flags, name: 'scope' });
	if (flags.has('scope') && scope !== 'single' && scope !== 'phased') throw new Error('--scope must be single or phased');
	if (!config) throw new Error('Planning requires lightsout.config.json');
	const runtime = await createPlanningRuntime({
		cwd,
		name,
		config,
		driver,
		mode: PlanningMode.Interactive,
		stage: PlanningVocabulary.Stage.Implementation,
		onProgress: (message) => console.error(message),
	});
	const snapshot = await ensurePlanningInput({ runtime });
	if (scope && snapshot.record.sources.some((source) => source.artifact !== 'foreground-layout.txt'))
		await capturePlanningLayout({ runtime, scope: scope === 'phased' ? PlanVariant.Overview : PlanVariant.Single });
	const result = await runPlanning({ runtime });
	await printPlanningRunResult({ result });
};
