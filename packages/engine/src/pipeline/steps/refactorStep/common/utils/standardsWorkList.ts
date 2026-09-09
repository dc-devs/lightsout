import { type StandardsFinding, StandardsSeverity } from '#src/contracts/index.ts';
import { standardsScopeFiles } from '#src/pipeline/common/utils/standardsScopeFiles.ts';
import type { PipelineRun } from '#src/pipeline/PipelineRun.ts';
import { attributeStandardsFindings, runStandardsCheck, selectStandardsFindings } from '#src/standardsCheck/index.ts';

interface Params {
	run: PipelineRun;
	/** The pre-edit baseline's findings, or undefined when the run has none. */
	baseline: StandardsFinding[] | undefined;
}

/**
 * One look at the deterministic checks, split into what cleanup may act on and
 * what it may only record. Never asks the agent to "go find problems" —
 * detection is code.
 *
 * Scoped with `standardsScopeFiles` rather than `sourceFiles`, because a
 * finding may be ABOUT a test file even though a test file never earns an agent
 * turn of its own. Scoping this with the agent-attention list silently discarded
 * every such finding, so the run reported zero blocking while they stood in the
 * tree.
 *
 * `all` is on, so the committed debt ledger suppresses nothing here. With the
 * default suppression a site the ledger accepts would never be seen at all, and
 * a ledgered file this run grew could never qualify; with it off, attribution
 * against the pre-edit baseline does the suppressing instead — an unchanged
 * ledgered site is inherited and buys nothing, one whose measure grew is
 * worsened and does.
 */
export const standardsWorkList = async ({
	run,
	baseline,
}: Params): Promise<{
	workList: StandardsFinding[];
	advisories: StandardsFinding[];
	inherited: StandardsFinding[];
	uncertain: StandardsFinding[];
}> => {
	const { findings } = await runStandardsCheck({ cwd: run.cwd, persist: false, all: true });
	const scoped = selectStandardsFindings({ findings, changedFiles: standardsScopeFiles({ run }) });
	const attributed = attributeStandardsFindings({ live: [...scoped.workList, ...scoped.advisories], baseline });
	const qualifying = [...attributed.introduced, ...attributed.worsened];

	return {
		workList: qualifying.filter((finding) => finding.severity === StandardsSeverity.Blocking),
		advisories: qualifying.filter((finding) => finding.severity === StandardsSeverity.Advisory),
		inherited: attributed.inherited,
		uncertain: attributed.uncertain,
	};
};
