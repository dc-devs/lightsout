import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { minimalPlanBody } from '#tests/helpers/minimalPlanBody.ts';
import { seedSourceRepo } from '#tests/helpers/seedSourceRepo.ts';
import { writeEmptyDecisions } from '#tests/helpers/writeEmptyDecisions.ts';

interface Params {
	/** Source files the repo already holds — what a planned symbol can collide with. */
	existing: string[];
	/** Paths the plan claims to create. */
	creates: string[];
	/** Kebab plan name — the workspace key. */
	name?: string;
}

/** A temp repo with the given existing source files, a single-file plan at `.lightsout/plans/<name>/plan.md`, and the empty decision record its Decision Log is judged against. */
export const seedDedupPlan = ({ existing, creates, name = 'p' }: Params): { cwd: string; name: string; workspaceDir: string } => {
	const cwd = seedSourceRepo({ existing });
	const workspaceDir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(join(workspaceDir, 'plan.md'), minimalPlanBody({ title: 'Plan', creates }));
	writeEmptyDecisions({ dir: workspaceDir, name });

	return { cwd, name, workspaceDir };
};
