import { basename, join } from 'node:path';
import { StructuralCheck, type StructuralFinding } from '@/contracts';
import type { ParsedPlan } from '@/plan/common/types/ParsedPlan';
import { pathExists } from '@/plan/common/paths/pathExists';

interface Params {
	plan: ParsedPlan;
	cwd: string;
	/** Absolute path to the plan file — its basename anchors each finding's location. */
	planPath: string;
}

/**
 * PathExists — modify/mirror paths must already exist on disk; Files-to-Create
 * paths must not. Every path is `stat`ed, and each mismatch is reported as a
 * typed finding with a plan-relative location.
 */
export const checkPlanPaths = async ({ plan, cwd, planPath }: Params): Promise<StructuralFinding[]> => {
	const findings: StructuralFinding[] = [];

	for (const path of [...plan.modifyPaths, ...plan.mirrorPaths]) {
		if (!(await pathExists({ path: join(cwd, path) }))) {
			findings.push({
				check: StructuralCheck.PathExists,
				issue: `referenced path does not exist: ${path}`,
				location: `${basename(planPath)} → ${path}`,
				fix: `correct the path or move it under Files to Create if it does not exist yet`,
			});
		}
	}

	for (const path of plan.createPaths) {
		if (await pathExists({ path: join(cwd, path) })) {
			findings.push({
				check: StructuralCheck.PathExists,
				issue: `Files to Create path already exists: ${path}`,
				location: `${basename(planPath)} → ${path}`,
				fix: `move it to Files to Modify, or choose a new path`,
			});
		}
	}

	return findings;
};
