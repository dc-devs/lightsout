import { join } from 'node:path';

interface Params {
	cwd: string;
}

/**
 * The folder every plan workspace lives in — one gitignored directory under the
 * repo root, holding one folder per plan.
 *
 * `planWorkspaceDir` answers for one workspace inside it; this answers for the
 * folder itself, which is what listing every plan a repo has needs.
 */
export const plansDir = ({ cwd }: Params): string => join(cwd, '.lightsout', 'plans');
