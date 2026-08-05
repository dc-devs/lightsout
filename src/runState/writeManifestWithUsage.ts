import type { RunManifest, RunUsage } from '@/contracts';
import { writeRunManifest } from '@/runState/writeRunManifest';

interface Params {
	cwd: string;
	manifest: RunManifest;
	patch?: Partial<RunManifest>;
	/** The run's live usage aggregate — stamped into the manifest once any invocation has landed. */
	usageTotals: RunUsage;
}

/**
 * Persist a manifest patch with the run's usage totals stamped in — the one
 * write path both pipelines share, so a resumed run's totals survive process
 * boundaries identically everywhere. Until the first invocation lands, the
 * manifest's existing usage is preserved rather than zeroed.
 */
export const writeManifestWithUsage = async ({ cwd, manifest, patch, usageTotals }: Params): Promise<RunManifest> => {
	const usage = usageTotals.invocations > 0 ? { ...usageTotals } : manifest.usage;

	return writeRunManifest({ cwd, manifest: { ...manifest, ...patch, usage } });
};
