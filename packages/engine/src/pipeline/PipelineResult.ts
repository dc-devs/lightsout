import type { RunManifest } from '@/contracts';

export interface PipelineResult {
	ok: boolean;
	manifest: RunManifest;
	/** Present when ok is false — what stopped the run, for the human. */
	error?: string;
}
