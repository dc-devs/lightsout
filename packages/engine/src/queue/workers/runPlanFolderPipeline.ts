import { join } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPhasesPipeline } from '#src/phases/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { pathExists, planWorkspaceDir } from '#src/plan/index.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';

interface Params {
	/** The worktree holding the plan folder, and where the pipeline runs. */
	cwd: string;
	/** The plan folder's name, which is the ticket's branch. */
	name: string;
	config: LightsoutConfig;
	driver: Driver;
	onProgress?: (message: string) => void;
}

/**
 * Build a plan folder the queue already knows exists, choosing the pipeline its
 * shape calls for and stating the result in the queue's own three terms.
 *
 * Whether the folder is there at all is the caller's business: the plan worker
 * fetches a missing one back from the ticket, and the auto-plan worker fails,
 * because a session that reported a plan it never wrote built nothing.
 *
 * It never relays a question. The implement pipelines take an existing manifest
 * and have no answer channel, so a question relayed out of here could never be
 * answered back into the run that asked it; an escalated run parks with its
 * worktree intact instead, the engine's existing recovery path for one.
 */
export const runPlanFolderPipeline = async ({ cwd, name, config, driver, onProgress }: Params): Promise<WorkerOutcome> => {
	const folder = planWorkspaceDir({ cwd, name });
	const overviewPath = join(folder, 'overview.md');
	const phased = await pathExists({ path: overviewPath });
	const result = phased
		? await runPhasesPipeline({ cwd, driver, config, overviewPath, onProgress })
		: await runImplementPipeline({ cwd, driver, config, planPath: join(folder, 'plan.md'), onProgress });

	if (result.ok) {
		return {};
	}

	const stated = result.error ?? `the run ended ${result.manifest.status}`;

	return { error: `${stated} — \`lightsout resume --run ${result.manifest.runId}\` continues it from the worktree` };
};
