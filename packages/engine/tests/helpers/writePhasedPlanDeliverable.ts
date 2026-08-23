import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	/** Plan file bodies by basename — an `overview.md` plus one `phase<N>-<slug>.md` beside it. */
	files: Record<string, string>;
}

/** Write a phased plan deliverable — an overview plus its phase files — into `<cwd>/.lightsout/plans/<name>/` and return the plan's folder. */
export const writePhasedPlanDeliverable = ({ cwd, name, files }: Params): string => {
	const dir = join(cwd, '.lightsout', 'plans', name);

	mkdirSync(dir, { recursive: true });

	for (const [fileName, body] of Object.entries(files)) {
		writeFileSync(join(dir, fileName), body);
	}

	return dir;
};
