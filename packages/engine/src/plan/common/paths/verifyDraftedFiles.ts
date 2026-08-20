import { isAbsolute, join } from 'node:path';
import { pathExists } from '#src/plan/common/paths/pathExists.ts';

interface Params {
	cwd: string;
	/** The paths the plan writer claims it authored, as reported. */
	filesWritten: { path: string }[];
}

/**
 * Resolve the writer's reported paths to absolute ones, confirming each is
 * really on disk.
 *
 * The agent owns a plan's content but never the claim that it exists: a report
 * naming files that were never written would otherwise be carried forward as a
 * clean draft, and every later step would read nothing. Reported paths may be
 * absolute or repo-relative, since that is the agent's choice to make.
 */
export const verifyDraftedFiles = async ({ cwd, filesWritten }: Params): Promise<{ planPaths: string[] } | { error: string }> => {
	const planPaths = filesWritten.map((file) => (isAbsolute(file.path) ? file.path : join(cwd, file.path)));

	if (planPaths.length === 0) {
		return { error: 'plan-writer reported drafted but listed no files written' };
	}

	const missing: string[] = [];

	for (const path of planPaths) {
		if (!(await pathExists({ path }))) {
			missing.push(path);
		}
	}

	if (missing.length > 0) {
		return { error: `plan-writer reported files that were not written: ${missing.join(', ')}` };
	}

	return { planPaths };
};
