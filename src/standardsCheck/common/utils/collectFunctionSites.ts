import { createHash } from 'node:crypto';
import type ts from 'typescript';
import type { FunctionSite } from '@/standardsCheck/common/types/FunctionSite';
import type { OversizedFunction } from '@/standardsCheck/common/types/OversizedFunction';
import { functionNameOf } from '@/standardsCheck/common/utils/functionNameOf';
import { normalizeFunctionTokens } from '@/standardsCheck/common/utils/normalizeFunctionTokens';

const functionSizeCaps = ({ name, path, caps }: { name: string; path: string; caps: Record<string, number> }) => {
	if (/^use[A-Z]/.test(name)) {
		return { cap: caps.hook, kind: 'hook' };
	}

	if (path.endsWith('.tsx') && /^[A-Z]/.test(name)) {
		return { cap: caps.component, kind: 'component' };
	}

	return { cap: caps.function, kind: 'function' };
};

interface Params {
	/** Repo-relative path, used for the .tsx-sensitive cap and the recorded site. */
	file: string;
	/** The file's contents. */
	text: string;
	compiler: typeof ts;
	/** Bodies below this normalized-token count are too small to call duplicates. */
	minBodyTokens: number;
	/** The `size-function` rule's line caps, keyed function/hook/component. */
	caps: Record<string, number>;
}

/**
 * One AST walk over a file, serving both rules that need it: the
 * normalized-token hash of every function body big enough to be a duplicate
 * candidate, and every function measured over the cap its NAME earns.
 *
 * Split out of `checkAstFindings` to leave that function sequencing its passes.
 * A module internal — its behaviour is pinned through the AST tier's own tests.
 */
export const collectFunctionSites = ({ file, text, compiler, minBodyTokens, caps }: Params): { sites: FunctionSite[]; oversized: OversizedFunction[] } => {
	const sourceFile = compiler.createSourceFile(file, text, compiler.ScriptTarget.Latest, true);
	const sites: FunctionSite[] = [];
	const oversized: OversizedFunction[] = [];

	const visit = (node: ts.Node) => {
		const isFunctionLike =
			compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node) || compiler.isArrowFunction(node) || compiler.isFunctionExpression(node);

		if (isFunctionLike && (node as ts.FunctionLikeDeclaration).body) {
			const body = (node as ts.FunctionLikeDeclaration).body as ts.Node;
			const tokens = normalizeFunctionTokens({ node: body, compiler });

			const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
			const endLine = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
			const name = functionNameOf({ node, compiler });

			if (tokens.length >= minBodyTokens) {
				sites.push({
					name,
					path: file,
					startLine,
					endLine,
					tokenCount: tokens.length,
					hash: createHash('sha1').update(tokens.join(',')).digest('hex'),
				});
			}

			const { cap, kind } = functionSizeCaps({ name, path: file, caps });
			const lines = endLine - startLine + 1;

			// Nested function-likes (arrow callbacks) are measured too, but
			// only named top-ish functions get size findings — callbacks
			// inherit their parent's budget.
			if (lines > cap && name !== '(anonymous)') {
				oversized.push({ name, kind, lines, cap, startLine, endLine });
			}
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return { sites, oversized };
};
