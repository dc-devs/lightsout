import type { StandardsFinding } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import type { LoadedStandardsPack } from '#src/standardsPacks/index.ts';

/**
 * Everything the cleanup loop reads and never changes, resolved once before the
 * first round — the rules, the comparison point, the budget and the tree as it
 * stood when cleanup began. Held together so a round runner reads one value
 * rather than eleven parameters that must stay in step.
 */
export interface CleanupContext {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	/** Overview text for a phased run — see `buildRefactorExecutorInvocation`. */
	overviewContent?: string;
	standards?: string;
	packs: LoadedStandardsPack[];
	channels: string[];
	/** The pre-edit baseline's findings, or undefined when the run has none. */
	baseline: StandardsFinding[] | undefined;
	/** How many cleanup executor rounds this run may spend at most. */
	budget: number;
	/** Fingerprints of the standards-scope changed files as cleanup began. */
	before: Record<string, string>;
	/** The judgment reviewer's read before the first round, reused as-is across a resume. */
	initialReview: StandardsFinding[];
}
