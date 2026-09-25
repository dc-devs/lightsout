import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveRecordedPlanPath } from '#src/plan/common/paths/resolveRecordedPlanPath.ts';

interface Params {
	cwd: string;
	/** The --plan value exactly as the user gave it. */
	planPath: string;
}

/**
 * Resolve what a --plan value points at. A file (or anything that is not a
 * directory, including a missing path) passes through unchanged — the pipeline
 * already owns the missing-file error. A directory means "run this plan,
 * however it is shaped": overview.md → all phases, plan.md → single run,
 * neither → an error naming both expectations.
 *
 * Where the value is looked for is `resolveRecordedPlanPath`'s answer, not
 * `cwd`'s own: a plan folder lives in the primary checkout whichever checkout
 * the run works in, so a run isolated in a worktree would otherwise find no
 * folder there and take a plan folder for a plain file.
 */
export const resolvePlanTarget = async ({ cwd, planPath }: Params): Promise<{ planPath: string } | { overviewPath: string } | { error: string }> => {
	const dir = await resolveRecordedPlanPath({ cwd, path: planPath });
	const isDirectory = await stat(dir).then(
		(entry) => entry.isDirectory(),
		() => false,
	);

	if (!isDirectory) {
		return { planPath };
	}

	const holds = async ({ name }: { name: string }) =>
		stat(join(dir, name)).then(
			(entry) => entry.isFile(),
			() => false,
		);

	// The joins are built from the user's own path, not the resolved absolute,
	// so a relative --plan stays relative — the form manifests store today.
	if (await holds({ name: 'overview.md' })) {
		return { overviewPath: join(planPath, 'overview.md') };
	}

	if (await holds({ name: 'plan.md' })) {
		return { planPath: join(planPath, 'plan.md') };
	}

	return { error: `plan folder holds neither overview.md nor plan.md: ${planPath}` };
};
