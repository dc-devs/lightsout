import type { RunManifest } from '@/contracts';

export interface RefactorResult {
	/** True for both clean completion and completion with declines — a decline is a judgment, not a failure. */
	ok: boolean;
	manifest: RunManifest;
	/** Present when ok is false — what stopped the run, for the human. */
	error?: string;
	/** Declined batches: step id → the agent's rationale lines. */
	declined: Array<{ batchId: string; remainingClusters: string[]; rationale: string[] }>;
	/** Finding counts per rule at run start (from the frozen worklist). */
	before: Record<string, number>;
	/** Finding counts per rule from the final whole-scope re-scan. */
	after: Record<string, number>;
}
