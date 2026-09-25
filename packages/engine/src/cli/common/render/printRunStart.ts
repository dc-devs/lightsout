import { printRunHeader } from '#src/cli/common/render/printRunHeader.ts';
import type { PlanTarget } from '#src/cli/common/types/PlanTarget.ts';
import type { LightsoutConfig } from '#src/contracts/LightsoutConfig.ts';
import type { Driver } from '#src/drivers/common/types/Driver.ts';

interface Params {
	target: PlanTarget;
	overviewPath: string | undefined;
	packages: string[] | undefined;
	startPhase: number | undefined;
	config: LightsoutConfig;
	driver: Driver;
	cwd: string;
	configPath: string;
}

/** The startup lines: what the run was started from, followed by the harness header every run prints. */
export const printRunStart = ({ target, overviewPath, packages, startPhase, config, driver, cwd, configPath }: Params): void => {
	console.log(`lightsout: starting run`);
	console.log(
		'overviewPath' in target
			? `  overview: ${target.overviewPath}${startPhase === undefined ? '' : `\n  start phase: ${startPhase}`}`
			: `  plan: ${target.planPath}${overviewPath ? `\n  overview: ${overviewPath}` : ''}${packages ? `\n  packages flag: ${packages.join(', ')}` : ''}`,
	);
	printRunHeader({ config, driver, cwd, configPath });
};
