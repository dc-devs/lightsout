import { readFile } from 'node:fs/promises';
import { resolveRecordedPlanPath } from '#src/plan/common/paths/resolveRecordedPlanPath.ts';

interface Params {
	cwd: string;
	/** Plan path as the manifest recorded it — repo-relative by contract; an absolute one from an older record still reads. */
	plan: string;
	/** Overview path for a phased plan, the same way. Absent for a single plan. */
	overview?: string;
}

/**
 * The plan text a run works from, plus the overview text when the plan is one
 * phase of a larger piece.
 *
 * A missing file is a failure rather than an empty string: every role's
 * invocation is built from this text, so an unreadable plan would otherwise
 * spawn agents with nothing to implement. The overview is only required when
 * the manifest says there is one.
 */
export const readPlanSources = async ({ cwd, plan, overview }: Params): Promise<{ planContent: string; overviewContent?: string } | { error: string }> => {
	// The shared resolver, not a bare resolve: a plans-directory record is read
	// from the primary checkout whichever checkout the run works in, an absolute
	// one is read where it points, and every other record is read under the repo.
	const planPath = await resolveRecordedPlanPath({ cwd, path: plan });
	const planContent = await readFile(planPath, 'utf8').catch(() => undefined);

	if (planContent === undefined) {
		return { error: `plan file not found: ${planPath}` };
	}

	if (overview === undefined) {
		return { planContent };
	}

	const overviewPath = await resolveRecordedPlanPath({ cwd, path: overview });
	const overviewContent = await readFile(overviewPath, 'utf8').catch(() => undefined);

	if (overviewContent === undefined) {
		return { error: `overview file not found: ${overviewPath}` };
	}

	return { planContent, overviewContent };
};
