import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { minimalPlanBody } from '#tests/helpers/minimalPlanBody.ts';
import { overviewMarker } from '#tests/helpers/overviewMarker.ts';
import { seedSourceRepo } from '#tests/helpers/seedSourceRepo.ts';

interface Params {
	/** Source files the repo already holds — what a planned symbol can collide with. */
	existing: string[];
	/** One entry per phase, each naming the paths that phase claims to create. */
	phases: string[][];
	/** Kebab plan name — the workspace key. */
	name?: string;
}

/**
 * A temp repo whose plan is phased: an `overview.md` fronting one
 * `phase<N>-part.md` per entry in `phases`, all in the plan's own folder.
 */
export const seedPhasedDedupPlan = ({ existing, phases, name = 'p' }: Params): { cwd: string; name: string; workspaceDir: string } => {
	const cwd = seedSourceRepo({ existing });
	const workspaceDir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(workspaceDir, { recursive: true });
	writeFileSync(join(workspaceDir, 'overview.md'), `# Plan — Overview\n\n## Cross-Phase Dependencies\n\n- ${overviewMarker}\n`);

	phases.forEach((creates, index) => {
		writeFileSync(join(workspaceDir, `phase${index + 1}-part.md`), minimalPlanBody({ title: `Phase ${index + 1}`, creates }));
	});

	return { cwd, name, workspaceDir };
};
