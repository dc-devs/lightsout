import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type ts from 'typescript';
import { ScanDetector, ScanSeverity, type ScanFinding } from '@lightsout/contracts';

/** Bodies below this normalized-token count are too small to call duplicates. */
const minBodyTokens = 40;

/** .tsx runs larger by nature (JSX + props interfaces around a 200-line component budget). */
const fileLineCap = (file: string) => (file.endsWith('.tsx') ? 300 : 250);

const functionSizeCaps = ({ name, path }: { name: string; path: string }) => {
	if (/^use[A-Z]/.test(name)) {
		return { cap: 160, kind: 'hook' };
	}

	if (path.endsWith('.tsx') && /^[A-Z]/.test(name)) {
		return { cap: 200, kind: 'component' };
	}

	return { cap: 80, kind: 'function' };
};

interface FunctionSite {
	name: string;
	path: string;
	startLine: number;
	endLine: number;
	hash: string;
	tokenCount: number;
}

interface Params {
	cwd: string;
	/** Repo-relative non-test source files. */
	files: string[];
	compiler: typeof ts;
}

/**
 * Tier 2 of the duplication ladder plus the size audit, one AST pass:
 * every function-like body is normalized (identifiers → ID, literals → LIT,
 * structure kept) and hashed — identical hashes across ≥2 sites are
 * systematic-rename duplicates that token-level cloning misses. The same
 * walk measures function/file line counts against the standards' numeric
 * thresholds (function 80 / hook 160 / component 200 / file 250).
 */
export const scanAstFindings = async ({ cwd, files, compiler }: Params) => {
	const findings: ScanFinding[] = [];
	const sites: FunctionSite[] = [];

	const normalize = (node: ts.Node): string[] => {
		if (compiler.isIdentifier(node) || compiler.isPrivateIdentifier(node)) {
			return ['ID'];
		}

		if (
			compiler.isStringLiteralLike(node) ||
			compiler.isNumericLiteral(node) ||
			node.kind === compiler.SyntaxKind.TrueKeyword ||
			node.kind === compiler.SyntaxKind.FalseKeyword
		) {
			return ['LIT'];
		}

		const children = node.getChildren();

		if (children.length === 0) {
			return [String(node.kind)];
		}

		return children.flatMap((child) => normalize(child));
	};

	const functionName = (node: ts.Node): string => {
		if ((compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node)) && node.name) {
			return node.name.getText();
		}

		const parent = node.parent;

		if (parent && compiler.isVariableDeclaration(parent) && compiler.isIdentifier(parent.name)) {
			return parent.name.getText();
		}

		return '(anonymous)';
	};

	for (const file of files) {
		const text = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (text === undefined) {
			continue;
		}

		const lineCount = text.split('\n').length;

		if (lineCount > fileLineCap(file) && basename(file) !== 'index.ts') {
			findings.push({
				detector: ScanDetector.Size,
				severity: ScanSeverity.Finding,
				cluster: `size:file:${file}`,
				files: [{ path: file }],
				detail: `${lineCount} lines (cap ~${fileLineCap(file)}) — split or graduate the concept`,
			});
		}

		const source = compiler.createSourceFile(file, text, compiler.ScriptTarget.Latest, true);

		const visit = (node: ts.Node) => {
			const isFunctionLike =
				compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node) || compiler.isArrowFunction(node) || compiler.isFunctionExpression(node);

			if (isFunctionLike && (node as ts.FunctionLikeDeclaration).body) {
				const body = (node as ts.FunctionLikeDeclaration).body as ts.Node;
				const tokens = normalize(body);

				const startLine = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
				const endLine = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
				const name = functionName(node);

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

				const { cap, kind } = functionSizeCaps({ name, path: file });
				const lines = endLine - startLine + 1;

				// Nested function-likes (arrow callbacks) are measured too, but
				// only named top-ish functions get size findings — callbacks
				// inherit their parent's budget.
				if (lines > cap && name !== '(anonymous)') {
					findings.push({
						detector: ScanDetector.Size,
						severity: ScanSeverity.Advisory,
						cluster: `size:${kind}:${file}:${name}`,
						files: [{ path: file, startLine, endLine }],
						detail: `${kind} '${name}' is ${lines} lines (cap ~${cap}) — extract logic (orchestration functions that only sequence step calls are exempt; judge before acting)`,
					});
				}
			}

			node.forEachChild(visit);
		};

		visit(source);
	}

	const byHash = new Map<string, FunctionSite[]>();

	for (const site of sites) {
		byHash.set(site.hash, [...(byHash.get(site.hash) ?? []), site]);
	}

	for (const [hash, group] of byHash) {
		if (group.length > 1) {
			findings.push({
				detector: ScanDetector.AstDuplicate,
				severity: ScanSeverity.Finding,
				cluster: `ast:${hash.slice(0, 12)}`,
				files: group.map((site) => ({ path: site.path, startLine: site.startLine, endLine: site.endLine })),
				detail: `${group.map((site) => `'${site.name}'`).join(', ')} have identical bodies after identifier normalization (${group[0]?.tokenCount} tokens)`,
			});
		}
	}

	return findings;
};
