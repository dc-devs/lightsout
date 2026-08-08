import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	body: string;
}

/** Write a single-file plan deliverable at `<cwd>/.lightsout/plans/<name>/plan.md` and return the plan's folder. */
export const writePlanDeliverable = ({ cwd, name, body }: Params): string => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), body);

	return dir;
};
