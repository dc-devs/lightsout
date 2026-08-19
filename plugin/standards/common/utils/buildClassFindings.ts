import type { RawStandardsFinding, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from './buildRawFinding.ts';

interface Params {
	input: SyntaxTreeInput;
	/** The rule id, exactly as its folder names it. */
	rule: string;
	guidance: string;
	/** The violation one class declaration carries, phrased for the finding's detail — or undefined when the class is fine. */
	getViolation: (params: { node: ts.ClassDeclaration; compiler: typeof ts }) => string | undefined;
}

/**
 * One finding per file over every class declaration it holds — the walk the
 * class-shape rules share, so each rule states only its own judgment of a
 * declaration. Per-file rather than per-class because every such rule's
 * remedy is one design pass over the file, however many classes sit in it.
 */
export const buildClassFindings = ({ input, rule, guidance, getViolation }: Params): RawStandardsFinding[] => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const violations: string[] = [];

		const visit = (node: ts.Node) => {
			const violation = input.compiler.isClassDeclaration(node) ? getViolation({ node, compiler: input.compiler }) : undefined;

			if (violation !== undefined) {
				violations.push(violation);
			}

			node.forEachChild(visit);
		};

		visit(tree);

		if (violations.length > 0) {
			findings.push(buildRawFinding({ rule, files: [{ path }], detail: violations.join('; '), guidance }));
		}
	}

	return findings;
};
