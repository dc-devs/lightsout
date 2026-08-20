import { mkdir } from 'node:fs/promises';
import { getPlanDetectionInputs } from '#src/plan/common/utils/getPlanDetectionInputs.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
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
export const getPlanDetectionPass = async ({ cwd, name }: Params): Promise<PlanDetectionPass> => {
	const workspaceDir = planWorkspaceDir({ cwd, name });

	await mkdir(workspaceDir, { recursive: true });

	const inputs = await getPlanDetectionInputs({ cwd, name });

	return { ...inputs, workspaceDir };
};
