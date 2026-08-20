import { pathToFileURL } from 'node:url';
import { StandardsCheckModule } from '#src/contracts/index.ts';
import { formatSchemaIssues } from '#src/standardsPackages/common/utils/formatSchemaIssues.ts';

interface Params {
	/** Absolute path of a rule folder's check.ts. */
	checkPath: string;
}

/**
 * Import one rule's check and validate its shape. The only place the engine
 * executes package code: the .ts file is imported directly under Node's native
 * type stripping, so a check must stay erasable-only and may import values from
 * inside its own package alone.
 *
 * @param checkPath - absolute path of the rule folder's check.ts
 * @throws {Error} When the file has no `check` export, or that export is not a valid check.
 */
export const loadCheckModule = async ({ checkPath }: Params): Promise<StandardsCheckModule> => {
	// @vite-ignore: the path is only known at run time — a bundler cannot
	// pre-resolve which standards package a consumer will point the engine at,
	// and must leave this import to Node. Server-only: nothing reachable from
	// the browser entry imports this module.
	const imported: Record<string, unknown> = await import(/* @vite-ignore */ pathToFileURL(checkPath).href);
	const parsed = StandardsCheckModule.safeParse(imported.check);

	if (!parsed.success) {
		throw new Error(
			`check.ts must export \`check\` as { inputKind, run } (${checkPath}): ${formatSchemaIssues({ issues: parsed.error.issues, subject: 'check' })}`,
		);
	}

	return parsed.data;
};
