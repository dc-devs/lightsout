import { mkdir } from 'node:fs/promises';
import { getPlanDetectionInputs } from './getPlanDetectionInputs';
import { planWorkspaceDir } from '../../planWorkspaceDir';

interface Params {
	cwd: string;
	/** Kebab plan name — the workspace key and the deliverable's basename. */
	name: string;
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
}

type PlanDetectionPass = Awaited<ReturnType<typeof getPlanDetectionInputs>> & {
	/** Created before the inputs are resolved, so a failed resolve still has somewhere to report from. */
	workspaceDir: string;
};

/**
 * The prologue both read-only detection passes (dedup, grade) open with: ensure
 * the plan's workspace directory exists, then gather the detection inputs.
 * `runPlanLint` takes the inputs alone — it writes nothing, so it needs no
 * workspace.
 */
export const getPlanDetectionPass = async ({ cwd, name, plansDir }: Params): Promise<PlanDetectionPass> => {
	const workspaceDir = planWorkspaceDir({ cwd, name });

	await mkdir(workspaceDir, { recursive: true });

	const inputs = await getPlanDetectionInputs({ cwd, name, plansDir });

	return { ...inputs, workspaceDir };
};
