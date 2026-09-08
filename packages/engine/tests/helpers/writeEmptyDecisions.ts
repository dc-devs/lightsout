import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';

interface Params {
	/** The plan's own folder — where its plan file(s) already went. */
	dir: string;
	/** Kebab plan name, which the record names as its own. */
	name: string;
}

/**
 * Write the empty decision record beside a fixture's plan file(s).
 *
 * Every read-only pass reads the record its plan file's Decision Log is judged
 * against, so a plan folder without one is a failed pass rather than a graded
 * plan. Spelled once because every fixture builder writes the same file, and the
 * record's shape is the engine's rather than any one of theirs.
 */
export const writeEmptyDecisions = ({ dir, name }: Params): void => {
	writeFileSync(join(dir, 'decisions.json'), JSON.stringify(emptyDecisionsRecord({ planName: name })));
};
