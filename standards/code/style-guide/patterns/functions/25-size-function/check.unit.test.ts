import { expect, describe, test } from '@jest/globals';
import type ts from 'typescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import { StandardsInputKind } from '@/contracts';
import type { StandardsCheckInput } from '@/contracts';
import { check } from './check.ts';

/** The caps this suite measures against — small enough that a fixture stays readable, and far enough apart that the three kinds cannot be confused. */
const caps = { function: 5, hook: 9, component: 12 };

/** A named arrow spanning exactly `lines` lines, its body padded with statements nothing else depends on. */
const buildArrow = ({ name, lines }: { name: string; lines: number }) =>
	[`export const ${name} = () => {`, ...Array.from({ length: lines - 2 }, (_, index) => `\tconst step${index} = ${index};`), '};'].join('\n');

/** A function whose only long thing is the callback it hands to `forEach` — the callback nobody named spans lines 4–9. */
const anonymousCallbackSource = [
	'export const buildReportSummary = ({ rows }: { rows: number[] }) => {',
	'\tconst totals: number[] = [];',
	'',
	'\trows.forEach((row) => {',
	'\t\tconst converted = row * 2;',
	'\t\tconst rounded = Math.round(converted);',
	'',
	'\t\ttotals.push(rounded);',
	'\t});',
	'',
	'\treturn totals;',
	'};',
].join('\n');

/** A function holding a named helper: the outer spans lines 1–10, the helper lines 2–7. */
const nestedHelperSource = [
	'export const buildReportSummary = ({ rows }: { rows: number[] }) => {',
	'\tconst convert = (row: number) => {',
	'\t\tconst doubled = row * 2;',
	'\t\tconst rounded = Math.round(doubled);',
	'',
	'\t\treturn rounded;',
	'\t};',
	'',
	'\treturn rows.map(convert);',
	'};',
].join('\n');

/** A class whose one method spans lines 2–7. */
const classMethodSource = [
	'export class Ledger {',
	'\ttotal({ amounts }: { amounts: number[] }): number {',
	'\t\tconst doubled = amounts.map((amount) => amount * 2);',
	'\t\tconst sum = doubled.reduce((left, right) => left + right, 0);',
	'',
	'\t\treturn sum;',
	'\t}',
	'}',
].join('\n');

/** A repo as the engine hands it to a syntax-tree rule: one parsed tree per source file, plus the compiler it borrowed. */
const setupSyntaxTreeInput = ({ sources }: { sources: Array<[string, string]> }): StandardsCheckInput => {
	const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

	if (compiler === undefined) {
		throw new Error('the repo running this suite must have a typescript to borrow');
	}

	const trees = new Map<string, ts.SourceFile>();

	for (const [path, text] of sources) {
		trees.set(path, compiler.createSourceFile(path, text, compiler.ScriptTarget.Latest, true));
	}

	const paths = sources.map(([path]) => path);

	return { kind: StandardsInputKind.SyntaxTree, cwd: '/repo', source: paths, tests: [], files: paths, referenceFiles: [], standardsPackages: [], compiler, trees };
};

/** The input a rule that did NOT declare `syntax-tree` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/reporting/buildReportSummary.ts'],
	spans: [],
});

describe('size-function check', () => {
	test('asks for parsed trees, since only the parse says where a signature and its closing brace sit', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a function past its cap, naming it, its span and the number it was measured against', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/buildReportSummary.ts', buildArrow({ name: 'buildReportSummary', lines: 7 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([
			{
				siteKey: 'size-function:src/reporting/buildReportSummary.ts',
				files: [{ path: 'src/reporting/buildReportSummary.ts', startLine: 1, endLine: 7 }],
				detail: "function 'buildReportSummary' is 7 lines (cap ~5)",
				guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
			},
		]);
	});

	test('leaves a function measured to exactly its cap — the cap is the last allowed line, not the first banned one', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/buildReportSummary.ts', buildArrow({ name: 'buildReportSummary', lines: 5 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([]);
	});

	test('a use-prefixed name earns the roomier hook budget, so a function too long for the function cap still passes', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/useReportRows.ts', buildArrow({ name: 'useReportRows', lines: 8 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([]);
	});

	test('reports a hook past the hook cap in the words for a hook', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/useReportRows.ts', buildArrow({ name: 'useReportRows', lines: 11 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]?.detail).toBe("hook 'useReportRows' is 11 lines (cap ~9)");
	});

	test('the name decides before the file does: a use-prefixed function in a .tsx is a hook, not a component', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/useReportRows.tsx', buildArrow({ name: 'useReportRows', lines: 11 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]?.detail).toBe("hook 'useReportRows' is 11 lines (cap ~9)");
	});

	test('a capitalized function in a .tsx is a component, on the roomiest cap of the three', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/ReportPanel.tsx', buildArrow({ name: 'ReportPanel', lines: 14 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]?.detail).toBe("component 'ReportPanel' is 14 lines (cap ~12)");
	});

	test('a capitalized function outside a .tsx is a plain function — the capital alone does not make a component', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/ReportPanel.ts', buildArrow({ name: 'ReportPanel', lines: 7 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]?.detail).toBe("function 'ReportPanel' is 7 lines (cap ~5)");
	});

	test('a lowercase function inside a .tsx is a plain function — the file alone does not make a component', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/ReportPanel.tsx', buildArrow({ name: 'renderReportRows', lines: 7 })]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]?.detail).toBe("function 'renderReportRows' is 7 lines (cap ~5)");
	});

	test('a callback nobody named inherits the budget of its parent instead of earning one of its own', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/buildReportSummary.ts', anonymousCallbackSource]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([
			{
				siteKey: 'size-function:src/reporting/buildReportSummary.ts',
				files: [{ path: 'src/reporting/buildReportSummary.ts', startLine: 1, endLine: 12 }],
				detail: "function 'buildReportSummary' is 12 lines (cap ~5)",
				guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
			},
		]);
	});

	test('a named helper nested in another function is measured on a budget of its own', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/reporting/buildReportSummary.ts', nestedHelperSource]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]).toStrictEqual({
			siteKey: 'size-function:src/reporting/buildReportSummary.ts',
			files: [
				{ path: 'src/reporting/buildReportSummary.ts', startLine: 1, endLine: 10 },
				{ path: 'src/reporting/buildReportSummary.ts', startLine: 2, endLine: 7 },
			],
			detail: "function 'buildReportSummary' is 10 lines (cap ~5); function 'convert' is 6 lines (cap ~5)",
			guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
		});
	});

	test('a class method is measured like any other function', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/ledger/Ledger.ts', classMethodSource]] });

		const findings = await check.run({ input, settings: caps });

		expect(findings[0]).toStrictEqual({
			siteKey: 'size-function:src/ledger/Ledger.ts',
			files: [{ path: 'src/ledger/Ledger.ts', startLine: 2, endLine: 7 }],
			detail: "function 'total' is 6 lines (cap ~5)",
			guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
		});
	});

	test('every oversized function of one file becomes one job, since the work is opening that file once', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/reporting/summaries.ts', [buildArrow({ name: 'buildReportSummary', lines: 7 }), buildArrow({ name: 'buildReportTotals', lines: 6 })].join('\n')],
			],
		});

		const findings = await check.run({ input, settings: caps });

		expect(findings).toStrictEqual([
			{
				siteKey: 'size-function:src/reporting/summaries.ts',
				files: [
					{ path: 'src/reporting/summaries.ts', startLine: 1, endLine: 7 },
					{ path: 'src/reporting/summaries.ts', startLine: 8, endLine: 13 },
				],
				detail: "function 'buildReportSummary' is 7 lines (cap ~5); function 'buildReportTotals' is 6 lines (cap ~5)",
				guidance: 'Extract logic. Orchestration that only sequences step calls is exempt — judge before acting.',
			},
		]);
	});

	test('each offending file is its own job, and the files within their caps are passed over', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/reporting/buildReportRows.ts', buildArrow({ name: 'buildReportRows', lines: 4 })],
				['src/reporting/buildReportSummary.ts', buildArrow({ name: 'buildReportSummary', lines: 7 })],
				['src/reporting/buildReportTotals.ts', buildArrow({ name: 'buildReportTotals', lines: 6 })],
			],
		});

		const findings = await check.run({ input, settings: caps });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual([
			'size-function:src/reporting/buildReportSummary.ts',
			'size-function:src/reporting/buildReportTotals.ts',
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: caps });

		expect(findings).toStrictEqual([]);
	});
});
