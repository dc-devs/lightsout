import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/findings/buildRawFinding.ts';
import { getFrameworkCarveOuts } from '../../../../../common/frameworks/getFrameworkCarveOuts.ts';
import { getPathCarveOut } from '../../../../../common/frameworks/getPathCarveOut.ts';
import { isUnderRouterRoot } from '../../../../../common/frameworks/isUnderRouterRoot.ts';
import { getBaseName } from '../../../../../common/paths/getBaseName.ts';
import { getDirectory } from '../../../../../common/paths/getDirectory.ts';

/**
 * Every index file, wherever it stands — a src root barrel holds no code any
 * more than an internal one does, so unlike barrel-star there is no root
 * exemption. A barrel under `common/` is spared the same way barrel-star
 * spares it: `path-common-barrel` objects to its existing at all. A file under
 * a package's router root is spared before this is ever asked.
 */
const isIndexFile = ({ path }: { path: string }) => /^index\.tsx?$/.test(getBaseName({ path })) && !getDirectory({ path }).split('/').includes('common');

/** The one statement kind a barrel may hold. `export *` passes here too — how a barrel re-exports is barrel-star's objection, not this rule's. */
const isReExport = ({ statement, compiler }: { statement: ts.Statement; compiler: typeof ts }) =>
	compiler.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined;

const buildFileFindings = ({ input }: { input: SyntaxTreeInput }) => {
	const findings: RawStandardsFinding[] = [];
	const carveOuts = getFrameworkCarveOuts({ dependencies: input.dependencies });

	for (const [path, tree] of input.trees) {
		// A file-based router (TanStack, Remix, Next) MANDATES an index route
		// file, and a route file's content is a route definition — never a
		// re-export. Judging one is asking for a file the framework forbids, so
		// the router root is the framework's to name, exactly as
		// `05-filename-mismatch` and `50-path-folder-casing` already concede.
		if (isUnderRouterRoot({ path, carveOut: getPathCarveOut({ carveOuts, path }) })) {
			continue;
		}

		if (isIndexFile({ path })) {
			const offending = tree.statements.filter((statement) => !isReExport({ statement, compiler: input.compiler }));
			const [first] = offending;

			if (first !== undefined) {
				const line = tree.getLineAndCharacterOfPosition(first.getStart(tree)).line + 1;

				findings.push(
					buildRawFinding({
						rule: 'index-not-barrel',
						files: [{ path }],
						detail: `${offending.length} statement(s) other than re-export lines, the first at line ${line}`,
						guidance: 'An index file is the module’s doorway — re-export lines only. Executable code belongs in a named entry file such as main.ts.',
					}),
				);
			}
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// Barrels in this codebase hold multi-line re-export statements, so the
	// verdict needs parsed statements — a line scan cannot tell the middle of an
	// `export type { … } from` block from a declaration.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input }) : []),
};
