import { readOptionalConfig } from '#src/common/config/readConfig.ts';
import type { LightsoutConfig } from '#src/contracts/index.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import { resolvePlanDeliverable } from '#src/plan/common/utils/resolvePlanDeliverable.ts';

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
	config?: LightsoutConfig;
	/** Set when the deliverable could not be resolved (propagated from resolvePlanDeliverable). */
	error?: string;
}

/**
 * Resolve a plan deliverable and derive the shared inputs every read-only
 * detection pass (dedup, grade) needs: the plan files, the full path list the
 * deterministic plan detectors read, and the target repo config. The dedup and
 * grade passes prepare these identically.
 */
export const getPlanDetectionInputs = async ({ cwd, name }: Params): Promise<PlanDetectionInputs> => {
	const deliverable = await resolvePlanDeliverable({ cwd, name });

	if (deliverable.error) {
		return { files: [], planPaths: [], error: deliverable.error };
	}

	const { overviewPath, overviewText, files } = deliverable;
	const planPaths = [...(overviewPath ? [overviewPath] : []), ...files.map((file) => file.path)];
	const config = await readOptionalConfig({ cwd });

	return { overviewText, files, planPaths, config };
};
