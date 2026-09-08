import { readOptionalConfig } from '#src/common/config/readOptionalConfig.ts';
import { messageOf } from '#src/common/utils/messageOf.ts';
import type { DecisionsRecord, LightsoutConfig } from '#src/contracts/index.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { resolvePlanDeliverable } from '#src/plan/common/utils/resolvePlanDeliverable.ts';
import { readMergedDecisions } from '#src/plan/decisionLog/index.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
}

interface PlanDetectionInputs {
	overviewText?: string;
	/** The judged/graded files: the single plan, or every phase (overview excluded). */
	files: DeliverableFile[];
	/** Every plan path (overview included) fed to the deterministic detectors. */
	planPaths: string[];
	/** The merged decision record the plan's Decision Log is judged against, brainstorm rows first. */
	decisions: DecisionsRecord;
	config?: LightsoutConfig;
	/** Set when the deliverable or the decision record could not be resolved. */
	error?: string;
}

/**
 * Resolve a plan deliverable and derive the shared inputs every read-only
 * detection pass (dedup, grade) needs: the plan files, the full path list the
 * deterministic plan detectors read, the merged decision record, and the target
 * repo config. The dedup and grade passes prepare these identically.
 *
 * A missing or unreadable `decisions.json` is the inputs error rather than a
 * quietly skipped comparison: every engine-drafted plan has one, and a check
 * whose input can be deleted is a check that can be switched off. The error
 * branches answer with an empty record because the return type demands one —
 * every caller reads `error` first and returns.
 */
export const getPlanDetectionInputs = async ({ cwd, name }: Params): Promise<PlanDetectionInputs> => {
	const deliverable = await resolvePlanDeliverable({ cwd, name });
	const empty: DecisionsRecord = { planName: name, decisions: [] };

	if (deliverable.error) {
		return { files: [], planPaths: [], decisions: empty, error: deliverable.error };
	}

	const { overviewPath, overviewText, files } = deliverable;
	const planPaths = [...(overviewPath ? [overviewPath] : []), ...files.map((file) => file.path)];
	const config = await readOptionalConfig({ cwd });
	const merged = await readMergedDecisions({ cwd, name }).catch((error: unknown) => messageOf({ error }));

	return typeof merged === 'string'
		? { overviewText, files, planPaths, decisions: empty, config, error: merged }
		: { overviewText, files, planPaths, decisions: merged.merged, config };
};
