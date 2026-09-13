import { PipelineKind, type RunManifest } from '#src/contracts/index.ts';
import { isRunInPlanWorkspace } from '#src/plan/index.ts';
import { listRunIds, readRunManifest } from '#src/runState/index.ts';

interface Params {
	/** The checkout whose run records are read, which is always the primary one. */
	primaryCheckout: string;
	/** The ticket folder's name, which is also the branch its plans implement on. */
	ticketBranch: string;
}

/** A run that built this folder itself, rather than one phase of it on behalf of a coordinator. */
const isFolderRun = ({ manifest, ticketBranch }: { manifest: RunManifest; ticketBranch: string }) =>
	manifest.parentRunId === undefined &&
	(manifest.pipeline === undefined || manifest.pipeline === PipelineKind.Implement || manifest.pipeline === PipelineKind.Phases) &&
	isRunInPlanWorkspace({ runPlan: manifest.plan, name: ticketBranch });

/**
 * The runs that say something about this folder's implementation: top-level
 * runs whose plan lies in it. A phase's child run is excluded, because one
 * phase passing is not the plan being implemented.
 */
export const readFolderRuns = async ({ primaryCheckout, ticketBranch }: Params): Promise<RunManifest[]> => {
	const runIds = await listRunIds({ cwd: primaryCheckout });
	const manifests = await Promise.all(runIds.map((runId) => readRunManifest({ cwd: primaryCheckout, runId }).catch(() => undefined)));

	return manifests.filter((manifest): manifest is RunManifest => manifest !== undefined && isFolderRun({ manifest, ticketBranch }));
};
