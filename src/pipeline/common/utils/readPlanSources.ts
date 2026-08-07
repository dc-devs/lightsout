import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Repo-relative plan path, as the manifest recorded it. */
	plan: string;
	/** Repo-relative overview path for a phased plan. Absent for a single plan. */
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
	const planPath = join(cwd, plan);
	const planContent = await readFile(planPath, 'utf8').catch(() => undefined);

	if (planContent === undefined) {
		return { error: `plan file not found: ${planPath}` };
	}

	if (overview === undefined) {
		return { planContent };
	}

	const overviewPath = join(cwd, overview);
	const overviewContent = await readFile(overviewPath, 'utf8').catch(() => undefined);

	if (overviewContent === undefined) {
		return { error: `overview file not found: ${overviewPath}` };
	}

	return { planContent, overviewContent };
};
