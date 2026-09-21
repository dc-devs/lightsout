import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planWorkspaceFolder } from '#tests/helpers/planWorkspaceFolder.ts';
import { writeEmptyDecisions } from '#tests/helpers/writeEmptyDecisions.ts';

interface Params {
	cwd: string;
	/** Kebab plan name — the folder the plan's own files live in. */
	name: string;
	body: string;
}

/**
 * Write a single-file plan deliverable at `<cwd>/.lightsout/tickets/<name>/plans/plan.md`
 * — with the empty decision record every read-only pass needs beside it — and
 * return the plan's folder.
 */
export const writePlanDeliverable = ({ cwd, name, body }: Params): string => {
	const dir = planWorkspaceFolder({ cwd: cwd, name: name });

	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'plan.md'), body);
	writeEmptyDecisions({ dir, name });

	return dir;
};
