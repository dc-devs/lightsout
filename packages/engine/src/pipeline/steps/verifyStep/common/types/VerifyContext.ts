import type { AcceptanceTestRecord } from '#src/contracts/index.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';

/**
 * Everything one verification checkpoint carries — through its gates, and
 * through every stage of its repair budget.
 *
 * A named type rather than each stage's own `Params`: the stages hand the whole
 * context on to one another unchanged, and a hand-copied shape at each hop is a
 * shadow contract that drifts.
 */
export interface VerifyContext {
	run: PipelineRun;
	gitPrefix?: string;
	planContent: string;
	/** Optional overview plan content (phased plans): context only, for the test-change reviewer. */
	overviewContent?: string;
	id: string;
	coverage?: boolean;
	/**
	 * The acceptance tests this checkpoint must prove, read from the manifest at
	 * every entry into the gates rather than captured once: a row a disposition
	 * renamed or moved during this very checkpoint has to be proven under the
	 * name it now carries. Empty where the plan carries no ledger.
	 */
	acceptanceTests: () => AcceptanceTestRecord[];
	/** True only at the run's last verification, where an acceptance test no gate proved is a failure rather than a skip. */
	final?: boolean;
	buildFix: ({ errorContext }: { errorContext: string }) => { systemPrompt: string; prompt: string };
}
