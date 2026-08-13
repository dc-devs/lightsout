import type ts from 'typescript';
import type { SpecifierResolver } from '@/common/types/SpecifierResolver';

interface Params {
	/** Repo-relative path of the barrel. */
	path: string;
	content: string;
	/** The consumer's TypeScript module (resolveConsumerTypescript). */
	compiler: typeof ts;
	/** Shared specifier resolver over the caller's file universe. */
	resolve: SpecifierResolver;
}

// A bare published-package reference — a single segment, or `@scope/name`
// with no deeper path — can never name a repo file, so failing to resolve
// one costs nothing.
const isExternalPackage = ({ specifier }: { specifier: string }) => {
	const segments = specifier.split('/');

	return segments.length === 1 || (specifier.startsWith('@') && segments.length === 2);
};

/**
 * What one barrel makes public, and whether the whole surface could be read.
 *
 * The completeness flag is the load-bearing half: a specifier this pass could
 * not place leaves the surface incomplete, and every argument from a file's
 * ABSENCE must stand down — silence for one folder beats invented boundaries.
 * Local exports without a module specifier contribute nothing.
 */
export const readBarrelExportTargets = ({ path, content, compiler, resolve }: Params): { targets: Set<string>; complete: boolean } => {
	const scriptKind = /\.tsx$/.test(path) ? compiler.ScriptKind.TSX : compiler.ScriptKind.TS;
	const source = compiler.createSourceFile(path, content, compiler.ScriptTarget.Latest, false, scriptKind);
	const targets = new Set<string>();
	let complete = true;

	for (const statement of source.statements) {
		if (!compiler.isExportDeclaration(statement) || statement.moduleSpecifier === undefined || !compiler.isStringLiteral(statement.moduleSpecifier)) {
			continue;
		}

		const specifier = statement.moduleSpecifier.text;
		const resolved = resolve({ from: path, specifier });

		if (resolved !== undefined) {
			targets.add(resolved);
		} else if (!isExternalPackage({ specifier })) {
			complete = false;
		}
	}

	return { targets, complete };
};
