import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Kebab plan name — the deliverable's basename. */
	name: string;
	body: string;
	/** Where committed deliverables live; defaults to the `.claude/plans` the engine falls back to. */
	plansDir?: string;
}

/** Write a committed single-file plan deliverable at `<plansDir>/<name>.md` and return the resolved plans directory. */
export const writePlanDeliverable = ({ cwd, name, body, plansDir = join(cwd, '.claude', 'plans') }: Params): string => {
	mkdirSync(plansDir, { recursive: true });
	writeFileSync(join(plansDir, `${name}.md`), body);

	return plansDir;
};
