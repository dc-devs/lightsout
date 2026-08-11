import { createProgressPrinter } from '@/cli/common/utils/createProgressPrinter';
import type { Effort, LightsoutConfig, Permissions } from '@/contracts';
import type { Driver } from '@/drivers';

interface Params {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	config: LightsoutConfig | undefined;
}

interface PlanRunOptions {
	cwd: string;
	driver: Driver;
	name: string;
	standards: string | undefined;
	model: string | undefined;
	effort: Effort | undefined;
	permissions: Permissions | undefined;
	onProgress: (message: string) => void;
}

/**
 * The options every agent-backed plan subcommand hands its runner: the plan's
 * identity, the harness settings lifted off the config, and a progress printer.
 * Extracted because dedup, draft and grade each spelled the same eight lines out
 * in full — a change to how the config reaches a runner had three places to go.
 */
export const planRunOptions = ({ cwd, driver, name, standards, config }: Params): PlanRunOptions => ({
	cwd,
	driver,
	name,
	standards,
	model: config?.model,
	effort: config?.effort,
	permissions: config?.permissions,
	onProgress: createProgressPrinter(),
});
