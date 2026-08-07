import { join } from 'node:path';
import { PlanVariant } from '@/contracts';

interface Params {
	/** Resolved absolute directory where committed plan deliverables live. */
	plansDir: string;
	/** Kebab plan name — the deliverable's basename, or its folder when phased. */
	name: string;
	variant: PlanVariant;
}

/**
 * Where a draft is written, and the directory that must exist first.
 *
 * Single → one file at `<plansDir>/<name>.md`. Phased → an overview at
 * `<plansDir>/<name>/overview.md` that fronts the phase files the agent
 * authors alongside it. Only the overview is named here: the engine owns the
 * entry path and the agent chooses the phase breakdown, so the phase paths come
 * back in its report rather than being dictated up front.
 */
export const planDraftOutputs = ({ plansDir, name, variant }: Params): { outputs: { path: string; variant: PlanVariant }[]; dir: string } => {
	if (variant === PlanVariant.Single) {
		return { outputs: [{ path: join(plansDir, `${name}.md`), variant: PlanVariant.Single }], dir: plansDir };
	}

	return { outputs: [{ path: join(plansDir, name, 'overview.md'), variant: PlanVariant.Overview }], dir: join(plansDir, name) };
};
