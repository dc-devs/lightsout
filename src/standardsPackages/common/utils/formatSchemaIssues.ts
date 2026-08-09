import type { ZodError } from 'zod';

interface Params {
	/** Every complaint the failed parse raised. */
	issues: ZodError['issues'];
	/** What to call an issue the schema raises against the whole value rather than one of its keys. */
	subject: string;
}

/**
 * Render every complaint a schema raised as one line, each named by the key it
 * lands on. A package author fixes a file once rather than reloading per field,
 * which is the same reason the loader batches its problems.
 *
 * @param issues - the failed parse's complaints
 * @param subject - stands in for the key when an issue names no path
 */
export const formatSchemaIssues = ({ issues, subject }: Params): string =>
	issues.map((issue) => `${issue.path.join('.') || subject} ${issue.message}`).join('; ');
