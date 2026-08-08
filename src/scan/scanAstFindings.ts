import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type ts from 'typescript';
import { StandardsRule, StandardsSeverity, type StandardsFinding } from '@/contracts';
import { normalizeFunctionTokens } from '@/scan/common/utils/normalizeFunctionTokens';
import { functionNameOf } from '@/scan/common/utils/functionNameOf';
import type { FunctionSite } from '@/scan/common/types/FunctionSite';
import { groupDuplicateFunctions } from '@/scan/common/utils/groupDuplicateFunctions';

/** Bodies below this normalized-token count are too small to call duplicates. */
const minBodyTokens = 40;

/** The standards' numeric tables as code — overridable per repo via config `scan.size`. .tsx files run larger by nature (JSX + props interfaces around the component budget). */
const defaultSizeCaps = { file: 250, tsxFile: 300, function: 80, hook: 160, component: 200 };

type SizeCaps = typeof defaultSizeCaps;

const fileLineCap = ({ file, caps }: { file: string; caps: SizeCaps }) => (file.endsWith('.tsx') ? caps.tsxFile : caps.file);

const functionSizeCaps = ({ name, path, caps }: { name: string; path: string; caps: SizeCaps }) => {
	if (/^use[A-Z]/.test(name)) {
		return { cap: caps.hook, kind: 'hook' };
	}

	if (path.endsWith('.tsx') && /^[A-Z]/.test(name)) {
		return { cap: caps.component, kind: 'component' };
	}

	return { cap: caps.function, kind: 'function' };
};

interface Params {
	cwd: string;
	/** Repo-relative non-test source files. */
	files: string[];
	compiler: typeof ts;
	/** Per-repo line-cap overrides (config `scan.size`), merged over the defaults. */
	size?: Partial<SizeCaps>;
}

/**
 * Tier 2 of the duplication ladder plus the size audit, one AST pass:
 * every function-like body is normalized (identifiers → ID, literals → LIT,
 * structure kept) and hashed — identical hashes across ≥2 sites are
 * systematic-rename duplicates that token-level cloning misses. The same
 * walk measures function/file line counts against the standards' numeric
 * thresholds (function 80 / hook 160 / component 200 / file 250).
 */
export const scanAstFindings = async ({ cwd, files, compiler, size }: Params): Promise<StandardsFinding[]> => {
	const caps = { ...defaultSizeCaps, ...size };
	const findings: StandardsFinding[] = [];
	const sites: FunctionSite[] = [];

	for (const file of files) {
		const text = await readFile(join(cwd, file), 'utf8').catch(() => undefined);

		if (text === undefined) {
			continue;
		}

		const lineCount = text.split('\n').length;

		if (lineCount > fileLineCap({ file, caps }) && basename(file) !== 'index.ts') {
			findings.push({
				rule: StandardsRule.Size,
				severity: StandardsSeverity.Finding,
				siteKey: `size:file:${file}`,
				files: [{ path: file }],
				detail: `${lineCount} lines (cap ~${fileLineCap({ file, caps })})`,
				guidance: 'Split the file, or graduate the concept it has grown into.',
			});
		}

		const source = compiler.createSourceFile(file, text, compiler.ScriptTarget.Latest, true);

		const visit = (node: ts.Node) => {
			const isFunctionLike =
				compiler.isFunctionDeclaration(node) || compiler.isMethodDeclaration(node) || compiler.isArrowFunction(node) || compiler.isFunctionExpression(node);

			if (isFunctionLike && (node as ts.FunctionLikeDeclaration).body) {
				const body = (node as ts.FunctionLikeDeclaration).body as ts.Node;
				const tokens = normalizeFunctionTokens({ node: body, compiler });

				const startLine = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
				const endLine = source.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
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
					findings.push({
						rule: StandardsRule.Size,
						severity: StandardsSeverity.Advisory,
						siteKey: `size:${kind}:${file}:${name}`,
						files: [{ path: file, startLine, endLine }],
						detail: `${kind} '${name}' is ${lines} lines (cap ~${cap})`,
						guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
					});
				}
			}

			node.forEachChild(visit);
		};

		visit(source);
	}

	findings.push(...groupDuplicateFunctions({ sites }));

	return findings;
};
