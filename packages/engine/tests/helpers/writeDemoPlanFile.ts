import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Params {
	cwd: string;
	/** The plan file's basename — `plan.md`, `overview.md`, or a `phase<N>-<slug>.md`. */
	name: string;
	body: string;
}

/**
 * Write a plan file into the `demo` plan's own folder and return its absolute
 * path.
 *
 * `demo` is the name the shared plan bodies and `emptyDecisionsRecord` already
 * default to, so a lint run over the returned path reads the record those
 * bodies render their Decision Log from.
 */
export const writeDemoPlanFile = ({ cwd, name, body }: Params): string => {
	const dir = join(cwd, '.lightsout', 'tickets', 'demo', 'plans');

	mkdirSync(dir, { recursive: true });

	const path = join(dir, name);

	writeFileSync(path, body);

	return path;
};
