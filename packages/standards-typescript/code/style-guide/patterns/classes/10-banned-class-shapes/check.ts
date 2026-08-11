import type { RawStandardsFinding, StandardsCheckModule, SyntaxTreeInput } from '@lightsout/standards-contracts';
import type ts from 'typescript';
import { buildRawFinding } from '../../../../../common/utils/buildRawFinding.ts';

/** Whether a class member carries one of the keywords the two banned shapes turn on. */
const hasModifier = ({ member, kind, compiler }: { member: ts.ClassElement; kind: ts.SyntaxKind; compiler: typeof ts }) => {
	const modifiers =
		compiler.isPropertyDeclaration(member) ||
		compiler.isMethodDeclaration(member) ||
		compiler.isGetAccessorDeclaration(member) ||
		compiler.isSetAccessorDeclaration(member)
			? member.modifiers
			: undefined;

	return (modifiers ?? []).some((modifier) => modifier.kind === kind);
};

/**
 * The classes the four criteria never licensed, and nothing but the declaration
 * is needed to say so.
 *
 * A class the framework mandates is out of scope: a decorated class is a NestJS
 * service or resolver, and an abstract one is the shared interface criterion (c)
 * describes, so neither is the module-in-a-costume this rule bans.
 */
const getBannedShape = ({ node, compiler }: { node: ts.ClassDeclaration; compiler: typeof ts }) => {
	const isFrameworkOwned = (node.modifiers ?? []).some((modifier) => compiler.isDecorator(modifier) || modifier.kind === compiler.SyntaxKind.AbstractKeyword);
	const name = node.name === undefined ? '(anonymous)' : node.name.text;
	const members = node.members;
	const methods = members.filter((member) => compiler.isMethodDeclaration(member));
	const state = members.filter(
		(member) =>
			compiler.isPropertyDeclaration(member) ||
			compiler.isConstructorDeclaration(member) ||
			compiler.isGetAccessorDeclaration(member) ||
			compiler.isSetAccessorDeclaration(member),
	);
	const isStaticOnly =
		!isFrameworkOwned && members.length > 0 && members.every((member) => hasModifier({ member, kind: compiler.SyntaxKind.StaticKeyword, compiler }));
	const isOneStatelessMethod = !isFrameworkOwned && methods.length === 1 && state.length === 0 && node.heritageClauses === undefined;
	let banned: string | undefined;

	if (isStaticOnly) {
		banned = `class '${name}' declares only static members`;
	} else if (isOneStatelessMethod) {
		banned = `class '${name}' is one stateless method`;
	}

	return banned;
};

/** One finding per file: the remedy is "replace these classes with module functions", which is one pass over the file. */
const buildFileFindings = ({ input }: { input: SyntaxTreeInput }) => {
	const findings: RawStandardsFinding[] = [];

	for (const [path, tree] of input.trees) {
		const banned: string[] = [];

		const visit = (node: ts.Node) => {
			const shape = input.compiler.isClassDeclaration(node) ? getBannedShape({ node, compiler: input.compiler }) : undefined;

			if (shape !== undefined) {
				banned.push(shape);
			}

			node.forEachChild(visit);
		};

		visit(tree);

		if (banned.length > 0) {
			findings.push(
				buildRawFinding({
					rule: 'banned-class-shape',
					files: [{ path }],
					detail: banned.join('; '),
					guidance: 'Write module functions instead — one exported function per file — and delete the class.',
				}),
			);
		}
	}

	return findings;
};

export const check: StandardsCheckModule = {
	inputKind: 'syntax-tree',
	// Both banned shapes are facts of the declaration itself — what its members
	// are and which of them bind state — so the tree answers the whole question.
	run: ({ input }): RawStandardsFinding[] => (input.kind === 'syntax-tree' ? buildFileFindings({ input }) : []),
};
