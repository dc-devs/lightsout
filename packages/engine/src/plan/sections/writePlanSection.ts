import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { writePlanFileIfChanged } from '#src/plan/common/rewriting/writePlanFileIfChanged.ts';
import type { SyncedPlanFile } from '#src/plan/common/types/SyncedPlanFile.ts';
import { rewritePlanSection } from '#src/plan/sections/rewritePlanSection.ts';

interface Params {
	/** Absolute path of the plan file to rewrite. */
	path: string;
	/** The `##` heading this section is found by, without the leading `##`. */
	heading: string;
	/** The rendered section text, heading line included. */
	section: string;
	/** The `##` heading whose section this one is placed immediately after when the file carries none. Appended at the end of the file when absent or itself not found. */
	after?: string;
}

/**
 * Put one rendered section into one plan file under its `##` heading, and touch
 * nothing else.
 *
 * The section's span is read from the parsed plan rather than rescanned here: a
 * second span scanner would be a second answer to where a section starts and
 * ends, which is the question the whole in-place rewrite turns on.
 */
export const writePlanSection = async ({ path, heading, section, after }: Params): Promise<SyncedPlanFile> => {
	const original = await readFile(path, 'utf8');
	const content = rewritePlanSection({ content: original, base: basename(path), heading, section, after });
	return writePlanFileIfChanged({ path, original, lines: content.split('\n') });
};
