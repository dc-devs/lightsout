import type ts from 'typescript';
import type { StandardsCheckModule } from '@/contracts';
import { buildTreeLineCheck } from '../../../../../common/utils/buildTreeLineCheck.ts';

/**
 * The comment forms a project uses to license a bypass. The rule allows a rare,
 * justified `any` behind one of these, so an annotation that carries one is the
 * document working rather than a violation of it — and the comment sits either
 * on the annotation's own line or on the line above it.
 */
const suppression = /biome-ignore|eslint-disable|@ts-ignore/;

/** The lines an unsuppressed `any` annotation appears on, 1-based. */
const findAnyLines = ({ sourceFile, compiler }: { sourceFile: ts.SourceFile; compiler: typeof ts }) => {
	const lines = sourceFile.getFullText().split('\n');
	const found: number[] = [];

	const visit = (node: ts.Node) => {
		if (node.kind === compiler.SyntaxKind.AnyKeyword) {
			const index = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line;

			if (!suppression.test(lines[index] ?? '') && !suppression.test(lines[index - 1] ?? '')) {
				found.push(index + 1);
			}
		}

		node.forEachChild(visit);
	};

	visit(sourceFile);

	return found;
};

// Parsed rather than scanned for the word: `any` is an ordinary identifier in a
// variable name, a string, or a comment, and only the tree says which
// occurrence is the type keyword the rule bans.
export const check: StandardsCheckModule = buildTreeLineCheck({
	rule: 'no-any',
	findLines: findAnyLines,
	detail: ({ lines }) => `\`any\` at ${lines.length > 1 ? 'lines' : 'line'} ${lines.join(', ')}`,
	guidance: 'Use `unknown` and narrow with a type guard, or name the type — a justified bypass needs the project’s lint-suppression comment.',
});
