import { loadConfig } from '@/common/utils/loadConfig';
import { resolvePlanDeliverable } from '@/plan/common/utils/resolvePlanDeliverable';

interface Params {
	cwd: string;
	/** Kebab plan name — the deliverable's basename. */
	name: string;
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
}

interface PlanDetectionInputs {
	overviewText?: string;
	/** The judged/graded files: the single plan, or every phase (overview excluded). */
	files: Awaited<ReturnType<typeof resolvePlanDeliverable>>['files'];
	/** Every plan path (overview included) fed to the deterministic detectors. */
	planPaths: string[];
	config?: Awaited<ReturnType<typeof loadConfig>>;
	/** Set when the deliverable could not be resolved (propagated from resolvePlanDeliverable). */
	error?: string;
}

/**
 * Resolve a plan deliverable and derive the shared inputs every read-only
 * detection pass (dedup, grade) needs: the plan files, the full path list the
 * deterministic detectors scan, and the target repo config. The dedup and grade
 * passes prepare these identically.
 */
export const getPlanDetectionInputs = async ({ cwd, name, plansDir }: Params): Promise<PlanDetectionInputs> => {
	const deliverable = await resolvePlanDeliverable({ name, plansDir });

	if (deliverable.error) {
		return { files: [], planPaths: [], error: deliverable.error };
	}

	const { overviewPath, overviewText, files } = deliverable;
	const planPaths = [...(overviewPath ? [overviewPath] : []), ...files.map((file) => file.path)];
	const config = await loadConfig({ cwd }).catch(() => undefined);

	return { overviewText, files, planPaths, config };
};
