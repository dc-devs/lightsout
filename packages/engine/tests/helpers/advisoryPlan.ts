import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';

/**
 * The existing modules an advisory plan makes its mechanical edit in — 50 of
 * them, so with the skeleton's one created file the plan touches 51.
 */
export const advisoryTouchedPaths = Array.from({ length: 50 }, (_, index) => `src/bulk${index}.ts`);

/**
 * The clean skeleton with a one-line edit planted in every `advisoryTouchedPaths`
 * file: 51 touched source files against the default 50-file executor limit, and
 * still only one created file.
 *
 * That is the shape the two size numbers exist to tell apart — a phase that
 * specifies almost nothing and edits an import everywhere is legal work, so it
 * must raise the advisory note and nothing blocking.
 */
export const advisoryPlanBody = ({ title }: { title?: string } = {}) => {
	const modifies = advisoryTouchedPaths.map((path) => `### \`${path}\`\n\nRename the import.\n`).join('\n');

	return cleanPlanBody({ title }).replace('## Patterns to Mirror', `${modifies}\n## Patterns to Mirror`);
};

/** Plant the modules the advisory plan edits, so the size note is the only thing the lint has to say about it. */
export const plantAdvisoryTouchedFiles = ({ cwd }: { cwd: string }): void => {
	for (const [index, path] of advisoryTouchedPaths.entries()) {
		writeFileSync(join(cwd, path), `export const bulk${index} = ${index};\n`);
	}
};
