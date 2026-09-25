import type { RunManifest } from '#src/contracts/run/RunManifest.ts';

export interface PipelineResult {
	ok: boolean;
	manifest: RunManifest;
	/** Present when ok is false — what stopped the run, for the human. */
	error?: string;
}
