import type ts from 'typescript';
import type { ModuleLink } from '../types/ModuleLink.ts';

interface Params {
	/** One parsed file, from the type-checker input. */
	sourceFile: ts.SourceFile;
	/** The checker of the program holding that file — the only thing that can say where a specifier points. */
	checker: ts.TypeChecker;
	compiler: typeof ts;
	/** Repo root, so a resolved absolute path can be reported the way every other path is. */
	cwd: string;
}

/** The module a specifier names, as a repo-relative path — undefined when it resolved outside the repo, or not at all. */
const resolveTarget = ({ specifier, checker, cwd }: { specifier: ts.Expression; checker: ts.TypeChecker; cwd: string }) => {
	const fileName = checker.getSymbolAtLocation(specifier)?.declarations?.[0]?.getSourceFile().fileName;

	if (fileName === undefined) {
		return { resolved: false };
	}

	const path = fileName.split('\\').join('/');
	const root = `${cwd.split('\\').join('/')}/`;

	// Resolved, but outside the repo — a published package. The line is fully
	// read; it simply contributes no target.
	return path.startsWith(root) ? { resolved: true, target: path.slice(root.length) } : { resolved: true };
};

/** The named specifiers of an import or export clause, source name and public name apart. */
const readNames = ({ bindings, compiler }: { bindings: ts.NamedImports | ts.NamedExports; compiler: typeof ts }) =>
	bindings.elements.map((element) => ({
		from: (compiler.isImportSpecifier(element) || compiler.isExportSpecifier(element) ? element.propertyName?.text : undefined) ?? element.name.text,
		as: element.name.text,
	}));

/**
 * Every `import … from` and `export … from` in one file, with each specifier
 * resolved to the file it names.
 *
 * The reason a rule reaches for the type checker rather than the text: asking
 * "does anything consume this barrel entry?" by searching for the NAME counts a
 * comment, a string and an unrelated variable of the same name, and cannot tell
 * an import from the parent barrel from an import from the child. A resolved
 * specifier answers which module a name actually came from, which is the
 * question every barrel rule is really asking.
 *
 * A default import is reported under the name `default`, and a namespace import
 * or `export *` as `star` with no names — the whole surface, with nothing
 * written down.
 */
export const readModuleLinks = ({ sourceFile, checker, compiler, cwd }: Params): ModuleLink[] => {
	const links: ModuleLink[] = [];

	for (const statement of sourceFile.statements) {
		if (compiler.isImportDeclaration(statement)) {
			const clause = statement.importClause;
			const bindings = clause?.namedBindings;
			const names = bindings !== undefined && compiler.isNamedImports(bindings) ? readNames({ bindings, compiler }) : [];

			links.push({
				typeOnly: clause?.isTypeOnly === true,
				reExport: false,
				star: bindings !== undefined && compiler.isNamespaceImport(bindings),
				names: clause?.name === undefined ? names : [{ from: 'default', as: clause.name.text }, ...names],
				...resolveTarget({ specifier: statement.moduleSpecifier, checker, cwd }),
			});
		}

		if (compiler.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
			const clause = statement.exportClause;

			links.push({
				typeOnly: statement.isTypeOnly,
				reExport: true,
				star: clause === undefined || compiler.isNamespaceExport(clause),
				names: clause !== undefined && compiler.isNamedExports(clause) ? readNames({ bindings: clause, compiler }) : [],
				...resolveTarget({ specifier: statement.moduleSpecifier, checker, cwd }),
			});
		}
	}

	return links;
};
