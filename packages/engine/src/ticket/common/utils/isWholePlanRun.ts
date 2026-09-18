import { resolve } from 'node:path';
import { PipelineKind } from '#src/contracts/index.ts';
import { planWorkspaceDir, resolveRecordedPlanPath } from '#src/plan/index.ts';

interface Params {
	/** The checkout the run builds in, which the plan path is resolved against. */
	cwd: string;
	/** The plan's name under the plans directory: a plan address, or a legacy folder's name. */
	name: string;
	/** The run's plan path as its manifest records it (or will). Undefined for a build from the ticket body. */
	planPath: string | undefined;
	/** The run's pipeline, where the caller knows it. */
	pipeline?: PipelineKind;
}

/** The two files a run over the WHOLE of a plan is started from. */
const wholePlanFileNames = ['plan.md', 'overview.md'];

/**
 * Whether a run covers the whole of a plan rather than one phase file of it.
 *
 * Only a whole-plan run may claim a plan implemented, and only a whole-plan run
 * may satisfy a ship request — so the rule is asked both before a run, to decide
 * what its pass would mean, and after it, to decide what to record. Asking it in
 * one place is what keeps those two answers the same.
 *
 * A build from the ticket body counts: it is the whole of single-plan plan 001's
 * implementation, and it has no plan file of its own to name. A `--start-phase`
 * run of a plan folder counts too, because it is still started from the folder's
 * own `overview.md`.
 *
 * @returns true when the run covers the whole plan
 */
export const isWholePlanRun = async ({ cwd, name, planPath, pipeline }: Params): Promise<boolean> => {
	if (pipeline === PipelineKind.Direct || planPath === undefined) {
		return true;
	}

	// The folder is the primary checkout's whatever checkout the run builds in, so
	// the recorded path has to be rooted the same way or no run ever matches.
	const folder = await planWorkspaceDir({ cwd, name });
	const recorded = await resolveRecordedPlanPath({ cwd, path: planPath });

	return wholePlanFileNames.some((file) => recorded === resolve(folder, file));
};
