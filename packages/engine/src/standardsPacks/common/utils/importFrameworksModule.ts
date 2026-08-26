import { pathToFileURL } from 'node:url';
import { StandardsFrameworksModule } from '#src/contracts/index.ts';
import { formatSchemaIssues } from '#src/standardsPacks/common/utils/formatSchemaIssues.ts';

interface Params {
	/** Absolute path of the pack's `common/frameworks/getFrameworkFacts.ts`. */
	modulePath: string;
}

/**
 * Import a pack's framework-facts module and validate its shape. Pack code the
 * engine executes, like a rule's check: the .ts file is imported directly under
 * Node's native type stripping, so it must stay erasable-only and may import
 * values from inside its own pack alone.
 *
 * @param modulePath - absolute path of the pack's common/frameworks/getFrameworkFacts.ts
 * @throws {Error} When the file has no `getFrameworkFacts` export, or that export is not a function.
 */
export const importFrameworksModule = async ({ modulePath }: Params): Promise<StandardsFrameworksModule> => {
	// @vite-ignore: the path is only known at run time — a bundler cannot
	// pre-resolve which standards pack a consumer will point the engine at,
	// and must leave this import to Node. Server-only: nothing reachable from
	// the browser entry imports this module.
	const imported: Record<string, unknown> = await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
	const parsed = StandardsFrameworksModule.safeParse(imported);

	if (!parsed.success) {
		throw new Error(
			`common/frameworks/getFrameworkFacts.ts must export \`getFrameworkFacts\` (${modulePath}): ${formatSchemaIssues({ issues: parsed.error.issues, subject: 'getFrameworkFacts' })}`,
		);
	}

	return parsed.data;
};
