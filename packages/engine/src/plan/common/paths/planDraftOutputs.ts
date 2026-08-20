import { join } from 'node:path';
import { PlanVariant } from '#src/contracts/index.ts';
import { planWorkspaceDir } from '#src/plan/planWorkspaceDir.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	variant: PlanVariant;
}

/**
 * Where a draft is written: into the plan's own workspace folder, beside the
 * working files it belongs to. Single → one file at `plan.md`, phased → an
 * overview at `overview.md` that fronts the phase files the agent authors
 * alongside it. Only the overview is named here: the engine owns the entry path
 * and the agent chooses the phase breakdown, so the phase paths come back in its
 * report rather than being dictated up front.
 */
export const planDraftOutputs = ({ cwd, name, variant }: Params): { path: string; variant: PlanVariant }[] => {
	const dir = planWorkspaceDir({ cwd, name });

	return variant === PlanVariant.Single
		? [{ path: join(dir, 'plan.md'), variant: PlanVariant.Single }]
		: [{ path: join(dir, 'overview.md'), variant: PlanVariant.Overview }];
};
