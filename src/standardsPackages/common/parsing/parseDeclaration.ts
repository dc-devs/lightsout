import type { z } from 'zod';
import { messageOf } from '@/common/utils/messageOf';
import { parseFrontMatter } from '@/standardsPackages/common/parsing/parseFrontMatter';
import { formatSchemaIssues } from '@/standardsPackages/common/utils/formatSchemaIssues';

interface Params<Shape> {
	/** The whole markdown file. */
	text: string;
	/** What this kind of file may declare in its front matter. */
	schema: z.ZodType<Shape>;
	/** Package-relative path of the file — names it in any problem reported against it. */
	filePath: string;
	/** Sink for problems — the loader throws them as one batch. */
	problems: string[];
}

/**
 * Read one markdown file's front matter against the schema its kind declares,
 * and hand back the prose below it. Both document.md and rule.md are read this
 * way, so a malformed declaration is reported in one voice whichever file it
 * sits in.
 *
 * A file whose front matter is unparseable or fails its schema reports the
 * fault and yields no declaration — the caller then drops whatever that
 * declaration would have described, rather than filling in defaults nobody
 * wrote. The prose comes back either way; it is the declaration that is in
 * doubt.
 *
 * @param text - the whole markdown file
 * @param schema - what this kind of file may declare
 * @param filePath - package-relative path, printed in any problem
 * @param problems - sink the loader throws as one batch
 */
export const parseDeclaration = <Shape>({ text, schema, filePath, problems }: Params<Shape>): { declaration?: Shape; body: string } => {
	let declaration: Shape | undefined;
	let body = '';

	try {
		const frontMatter = parseFrontMatter({ text });
		const parsed = schema.safeParse(frontMatter.data);

		body = frontMatter.body.trim();

		if (parsed.success) {
			declaration = parsed.data;
		} else {
			problems.push(`${filePath}: ${formatSchemaIssues({ issues: parsed.error.issues, subject: 'front matter' })}`);
		}
	} catch (error) {
		problems.push(`${filePath}: ${messageOf({ error })}`);
	}

	return { declaration, body };
};
