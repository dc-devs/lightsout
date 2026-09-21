import { PipelineKind, type RunManifest } from '#src/contracts/index.ts';
import { listRunIds, readRunManifest } from '#src/runState/index.ts';

interface Params {
	/** The checkout whose run records are read, which is always the primary one. */
	primaryCheckout: string;
	/** The source folder's name, which is a plan folder's bare name and only sometimes the ticket's own branch. */
	planName: string;
}

/** A run that built this folder itself, rather than one phase of it on behalf of a coordinator. */
const isFolderRun = ({ manifest, planName }: { manifest: RunManifest; planName: string }) =>
	manifest.parentRunId === undefined &&
	(manifest.pipeline === undefined || manifest.pipeline === PipelineKind.Implement || manifest.pipeline === PipelineKind.Phases) &&
	manifest.planName === planName;

/**
 * The runs that say something about this folder's implementation: top-level
 * runs that recorded the folder as the plan they belong to. A phase's child run
 * is excluded, because one phase passing is not the plan being implemented.
 */
export const readLooseFileRuns = async ({ primaryCheckout, planName }: Params): Promise<RunManifest[]> => {
	// One ticket's runs folder, never another's.
	const runIds = await listRunIds({ cwd: primaryCheckout, ticketBranch: planName });
	const manifests = await Promise.all(runIds.map((runId) => readRunManifest({ cwd: primaryCheckout, runId }).catch(() => undefined)));

	return manifests.filter((manifest): manifest is RunManifest => manifest !== undefined && isFolderRun({ manifest, planName }));
};
