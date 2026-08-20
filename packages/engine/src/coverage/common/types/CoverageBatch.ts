import type { CoverageFile } from '#src/contracts/index.ts';

/** One round's batch: whole import-graph components of one scope, ~batchSize tracked candidates. */
export interface CoverageBatch {
	/** Manifest step id: `batch-NN:<scope>` (NN zero-padded, sequential across the run including resumes). */
	id: string;
	/** Package dir name, or 'root'. */
	scope: string;
	/** Tracked candidates, worst-first; carries each file's pre-batch statements pct for the improvement comparison and strikes. */
	files: CoverageFile[];
	/** Every file handed to the writer: the batch components' full membership — tracked candidates plus well-covered boundary/internal riders. Superset of `files` paths. */
	members: string[];
}
