import { join } from 'node:path';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { Driver } from '#src/drivers/index.ts';
import { runPhasesPipeline } from '#src/phases/index.ts';
import { runImplementPipeline } from '#src/pipeline/index.ts';
import { pathExists, planWorkspaceDir, recordPlanCommandRun } from '#src/plan/index.ts';
import type { WorkerOutcome } from '#src/queue/common/types/WorkerOutcome.ts';
import { runWorkOrderPlanLifecycle } from '#src/workOrder/index.ts';

interface Params {
	/** The worktree holding the plan folder, and where the pipeline runs. */
	cwd: string;
	/** The plan's address, `<ticket-branch>/<plan-id>`, or the branch-named folder of a ticket with no record. */
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
 * The run goes through the ticket lifecycle helper, so a plan the ticket's record
 * says may not be built yet becomes a worker error rather than a build — and a
 * plan that passes is recorded implemented on the record every later plan and
 * every ship reads. A folder with no record builds exactly as it always has.
 *
 * The build is recorded as one command run under the plan's own level, labelled
 * `implement` — the same word a hand-typed `lightsout implement` records,
 * because it is the same build. The queue's own coordinator run records nothing.
 *
 * It never relays a question. The implement pipelines take an existing manifest
 * and have no answer channel, so a question relayed out of here could never be
 * answered back into the run that asked it; an escalated run parks with its
 * worktree intact instead, the engine's existing recovery path for one.
 */
export const runPlanFolderPipeline = async ({ cwd, name, config, driver, onProgress }: Params): Promise<WorkerOutcome> => {
	const folder = await planWorkspaceDir({ cwd, name });
	const overviewPath = join(folder, 'overview.md');
	const phased = await pathExists({ path: overviewPath });
	const outcome = await runWorkOrderPlanLifecycle({
		cwd,
		name,
		run: ({ runId }) =>
			recordPlanCommandRun({
				cwd,
				name,
				label: 'implement',
				statusOf: ({ result }) => result.manifest.status,
				work: ({ level }) =>
					phased
						? runPhasesPipeline({ cwd, driver, config, overviewPath, runId, level, onProgress })
						: runImplementPipeline({ cwd, driver, config, planPath: join(folder, 'plan.md'), runId, level, onProgress }),
			}),
	});

	if ('refusal' in outcome) {
		return { error: outcome.refusal };
	}

	const { result, recordError } = outcome;

	if (result.ok) {
		return recordError === undefined ? {} : { error: recordError };
	}

	const stated = result.error ?? `the run ended ${result.manifest.status}`;

	return { error: `${stated} — \`lightsout resume --run ${result.manifest.runId}\` continues it from the worktree` };
};
