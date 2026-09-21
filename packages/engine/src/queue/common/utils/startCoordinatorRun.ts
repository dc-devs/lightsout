import { join } from 'node:path';
import { type LightsoutConfig, PipelineKind, type RunManifest, RunStatus } from '#src/contracts/index.ts';
import { createRun, resolveNewRunDir, seedUsageTotals, writeManifestWithUsage } from '#src/runState/index.ts';

interface Params {
	cwd: string;
	/** Pre-minted id — the drain takes the run lock under it before anything is written. */
	runId: string;
	/** Recorded on the manifest as the harness name. */
	driverName: string;
	config: LightsoutConfig;
}

/**
 * The coordinator's own run, created and marked running.
 *
 * Its directory is resolved before the run exists, because the manifest's
 * `plan` field points at a `queue.md` inside it — and the drain hands that same
 * directory to every ticket it builds.
 */
export const startCoordinatorRun = async ({
	cwd,
	runId,
	driverName,
	config,
}: Params): Promise<{ coordinatorRunDir: string; planPath: string; manifest: RunManifest }> => {
	const coordinatorRunDir = await resolveNewRunDir({ cwd, pipeline: PipelineKind.Queue, runId });
	const planPath = join(coordinatorRunDir, 'queue.md');
	const manifest = await createRun({ cwd, runId, plan: planPath, pipeline: PipelineKind.Queue, driver: driverName, config });

	await writeManifestWithUsage({ cwd, manifest, patch: { status: RunStatus.Running }, usageTotals: seedUsageTotals({ usage: manifest.usage }) });

	return { coordinatorRunDir, planPath, manifest };
};
