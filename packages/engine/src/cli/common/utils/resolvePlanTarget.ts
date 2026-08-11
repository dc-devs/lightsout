import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
 */
export const resolvePlanTarget = async ({ cwd, planPath }: Params): Promise<{ planPath: string } | { overviewPath: string } | { error: string }> => {
	const isDirectory = await stat(resolve(cwd, planPath)).then(
		(entry) => entry.isDirectory(),
		() => false,
	);

	if (!isDirectory) {
		return { planPath };
	}

	const holds = async (name: string) =>
		stat(resolve(cwd, planPath, name)).then(
			(entry) => entry.isFile(),
			() => false,
		);

	// The joins are built from the user's own path, not the resolved absolute,
	// so a relative --plan stays relative — the form manifests store today.
	if (await holds('overview.md')) {
		return { overviewPath: join(planPath, 'overview.md') };
	}

	if (await holds('plan.md')) {
		return { planPath: join(planPath, 'plan.md') };
	}

	return { error: `plan folder holds neither overview.md nor plan.md: ${planPath}` };
};
