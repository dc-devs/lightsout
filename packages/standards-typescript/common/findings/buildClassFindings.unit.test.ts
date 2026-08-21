import { describe, expect, test } from '@jest/globals';
import type { SyntaxTreeInput } from '@lightsout/standards-contracts';
import ts from 'typescript';
import { buildClassFindings } from './buildClassFindings.ts';

const treeOf = ({ path, text }: { path: string; text: string }) => ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);

const inputOf = (files: Record<string, string>): SyntaxTreeInput => ({
	kind: 'syntax-tree',
	cwd: '/repo',
	standardsPackages: [],
	source: Object.keys(files),
	tests: [],
	files: Object.keys(files),
	referenceFiles: [],
	compiler: ts,
	dependencies: new Map(),
	trees: new Map(Object.entries(files).map(([path, text]) => [path, treeOf({ path, text })])),
});

const params = {
	rule: 'demo-rule',
	guidance: 'the remedy line',
	/** Flags every class whose name starts with Bad — judgment enough to see the walk work. */
	getViolation: ({ node }: { node: ts.ClassDeclaration }) => {
		const name = node.name?.text ?? '(anonymous)';

		return name.startsWith('Bad') ? `class '${name}' is bad` : undefined;
	},
};

describe('buildClassFindings', () => {
	test('one finding per file, carrying every violating class and the rule’s own words', () => {
		const findings = buildClassFindings({
			input: inputOf({ 'src/a.ts': 'class BadOne {}\nclass Fine {}\nclass BadTwo {}\n', 'src/b.ts': 'class AlsoFine {}\n' }),
			...params,
		});

		// the rule id lands only in the site key — the engine stamps the field
		// itself from the folder the check was loaded from
		expect(findings).toStrictEqual([
			{
				siteKey: 'demo-rule:src/a.ts',
				files: [{ path: 'src/a.ts' }],
				detail: "class 'BadOne' is bad; class 'BadTwo' is bad",
				guidance: 'the remedy line',
			},
		]);
	});

	test('a class nested inside a function is still walked — the visitor reads the whole tree', () => {
		const findings = buildClassFindings({
			input: inputOf({ 'src/nested.ts': 'const make = () => { class BadNested {} return BadNested; };\n' }),
			...params,
		});

		expect(findings.map((finding) => finding.detail)).toStrictEqual(["class 'BadNested' is bad"]);
	});
});
