import type { StructuralFinding } from '#src/contracts/index.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { getPlanDetectionInputs } from '#src/plan/common/utils/getPlanDetectionInputs.ts';
import { lintPlanStructure } from '#src/plan/lintPlanStructure.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	onProgress?: (message: string) => void;
}

type RunPlanLintResult =
	| { status: typeof PlanRunStatus.Complete; findings: StructuralFinding[]; planPaths: string[] }
	| { status: typeof PlanRunStatus.Failed; error: string };

/**
 * The structural lint as a standalone pass — no agent, no driver, no workspace
 * writes. It resolves the deliverable exactly as grade does and reports the same
 * typed findings, so the plan writer can converge in-session (where its context
 * is already loaded) instead of paying a repair spawn per finding.
 */
export const runPlanLint = async ({ cwd, name, onProgress }: Params): Promise<RunPlanLintResult> => {
	const progress = onProgress ?? (() => undefined);
	const inputs = await getPlanDetectionInputs({ cwd, name });

	if (inputs.error) {
		return { status: PlanRunStatus.Failed, error: inputs.error };
	}

	const findings = await lintPlanStructure({ cwd, planPaths: inputs.planPaths, config: inputs.config });

	progress(`plan lint ${name}: ${findings.length} structural finding(s) across ${inputs.planPaths.length} file(s)`);

	return { status: PlanRunStatus.Complete, findings, planPaths: inputs.planPaths };
};
