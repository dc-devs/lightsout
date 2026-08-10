import { describe, expect, test } from '@jest/globals';
import type ts from 'typescript';
import { resolveConsumerTypescript } from '@/common/utils/resolveConsumerTypescript';
import type { StandardsCheckInput } from '@/contracts';
import { StandardsInputKind } from '@/contracts';
import { check } from './check.ts';

/** An arrow on lines 1–6 whose body is two statements and a shorthand return. */
const formatAmountSource = `export const formatAmount = ({ amount, fee }: { amount: number; fee: number }) => {
	const total = amount + fee;
	const doubled = total * total;

	return { total, doubled };
};
`;

/** The same body on lines 1–6 with every identifier renamed. */
const formatTotalSource = `export const formatTotal = ({ price, tax }: { price: number; tax: number }) => {
	const sum = price + tax;
	const scaled = sum * sum;

	return { sum, scaled };
};
`;

/** A shorter body on lines 1–5 — one statement fewer, so a different shape. */
const formatNetSource = `export const formatNet = ({ price, tax }: { price: number; tax: number }) => {
	const sum = price + tax;

	return { sum };
};
`;

/** An arrow on lines 1–7 whose body leans on a number, a string and a boolean. */
const buildLabelSource = `export const buildLabel = ({ item }: { item: { size: number; name: string } }) => {
	const size = item.size + 10;
	const label = item.name + 'small';
	const flag = size > 20 && true;

	return { size, label, flag };
};
`;

/** The same body on lines 1–7 with different names AND different literal values. */
const buildTagSource = `export const buildTag = ({ entry }: { entry: { size: number; name: string } }) => {
	const width = entry.size + 99;
	const tag = entry.name + 'large';
	const mark = width > 4 && false;

	return { width, tag, mark };
};
`;

/** A method on lines 4–9 reading a private field. */
const ledgerSource = `export class Ledger {
	#alpha = 0;

	total({ amount }: { amount: number }) {
		const next = this.#alpha + amount;
		const doubled = next * next;

		return { next, doubled };
	}
}
`;

/** The same method body on lines 4–9, private field included, under other names. */
const registerSource = `export class Register {
	#beta = 0;

	sum({ amount }: { amount: number }) {
		const value = this.#beta + amount;
		const scaled = value * value;

		return { value, scaled };
	}
}
`;

/** A thin wrapper whose only distinguishing content is the hook it binds. */
const hookWrapper = ({ name, hook, field }: { name: string; hook: string; field: string }) => `export const ${name} = ({ id }: { id: number }) => {
	const ${field} = ${hook}();
	const ready = ${field}.status;

	return { id, ready };
};
`;

/** A repo as the engine hands it to a syntax-tree rule: one parsed tree per source file, plus the compiler it borrowed. */
const setupSyntaxTreeInput = ({ sources, standardsPackages = [] }: { sources: Array<[string, string]>; standardsPackages?: string[] }): StandardsCheckInput => {
	const compiler = resolveConsumerTypescript({ cwd: process.cwd() });

	if (compiler === undefined) {
		throw new Error('the repo running this suite must have a typescript to borrow');
	}

	const trees = new Map<string, ts.SourceFile>();

	for (const [path, text] of sources) {
		trees.set(path, compiler.createSourceFile(path, text, compiler.ScriptTarget.Latest, true));
	}

	const paths = sources.map(([path]) => path);

	return { kind: StandardsInputKind.SyntaxTree, cwd: '/repo', source: paths, tests: [], files: paths, referenceFiles: [], standardsPackages, compiler, trees };
};

/** The input a rule that did NOT declare `syntax-tree` would receive — an arm the union permits but a run never produces. */
const setupOtherKindInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.CloneSpans,
	cwd: '/repo',
	source: ['src/billing/formatAmount.ts'],
	spans: [],
});

describe('ast-duplicate check', () => {
	test('asks for parsed trees, since the verdict is about shape rather than text', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports two bodies that differ only in the names they use, naming both functions and where they sit', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/billing/formatAmount.ts', formatAmountSource],
				['src/invoices/formatTotal.ts', formatTotalSource],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings).toEqual([
			{
				siteKey: 'ast-duplicate:src/billing/formatAmount.ts|src/invoices/formatTotal.ts',
				files: [
					{ path: 'src/billing/formatAmount.ts', startLine: 1, endLine: 6 },
					{ path: 'src/invoices/formatTotal.ts', startLine: 1, endLine: 6 },
				],
				detail: expect.stringMatching(/^'formatAmount', 'formatTotal' \(\d+ tokens\) have identical bodies after identifier normalization$/),
				guidance: 'Renaming the identifiers did not make these different functions.',
			},
		]);
	});

	test('the numbers, strings and booleans a body uses are blurred away, so copies that only changed those values are still duplicates', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/labels/buildLabel.ts', buildLabelSource],
				['src/labels/buildTag.ts', buildTagSource],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['ast-duplicate:src/labels/buildLabel.ts|src/labels/buildTag.ts']);
	});

	test('a private field name is blurred like any other identifier', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/ledger/Ledger.ts', ledgerSource],
				['src/register/Register.ts', registerSource],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings.map(({ files }) => files)).toStrictEqual([
			[
				{ path: 'src/ledger/Ledger.ts', startLine: 4, endLine: 9 },
				{ path: 'src/register/Register.ts', startLine: 4, endLine: 9 },
			],
		]);
	});

	test('wrappers binding DIFFERENT hooks are not duplicates — the hook is what makes them un-mergeable', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/github/GitHubButton.ts', hookWrapper({ name: 'GitHubButton', hook: 'useCreateGitHubInstallation', field: 'mutation' })],
				['src/linear/LinearButton.ts', hookWrapper({ name: 'LinearButton', hook: 'useCreateLinearInstallation', field: 'mutation' })],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings).toStrictEqual([]);
	});

	test('wrappers binding the SAME hook under other names are duplicates', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/alpha/AlphaButton.ts', hookWrapper({ name: 'AlphaButton', hook: 'useSharedThing', field: 'alpha' })],
				['src/beta/BetaButton.ts', hookWrapper({ name: 'BetaButton', hook: 'useSharedThing', field: 'beta' })],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings.map(({ siteKey }) => siteKey)).toStrictEqual(['ast-duplicate:src/alpha/AlphaButton.ts|src/beta/BetaButton.ts']);
	});

	test('two duplicated bodies across the same pair of files are one finding naming both, since the identity is the paths', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/billing/amounts.ts', [formatAmountSource, buildLabelSource].join('\n')],
				['src/invoices/totals.ts', [formatTotalSource, buildTagSource].join('\n')],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings).toEqual([
			{
				siteKey: 'ast-duplicate:src/billing/amounts.ts|src/invoices/totals.ts',
				files: [
					{ path: 'src/billing/amounts.ts', startLine: 1, endLine: 6 },
					{ path: 'src/invoices/totals.ts', startLine: 1, endLine: 6 },
					{ path: 'src/billing/amounts.ts', startLine: 8, endLine: 14 },
					{ path: 'src/invoices/totals.ts', startLine: 8, endLine: 14 },
				],
				detail: expect.stringMatching(
					/^'formatAmount', 'formatTotal' \(\d+ tokens\); 'buildLabel', 'buildTag' \(\d+ tokens\) have identical bodies after identifier normalization$/,
				),
				guidance: 'Renaming the identifiers did not make these different functions.',
			},
		]);
	});

	test('a body copied within one file is reported against that file once, with both spans', async () => {
		const input = setupSyntaxTreeInput({ sources: [['src/billing/amounts.ts', [formatAmountSource, formatTotalSource].join('\n')]] });

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings.map(({ siteKey, files }) => ({ siteKey, files }))).toStrictEqual([
			{
				siteKey: 'ast-duplicate:src/billing/amounts.ts',
				files: [
					{ path: 'src/billing/amounts.ts', startLine: 1, endLine: 6 },
					{ path: 'src/billing/amounts.ts', startLine: 8, endLine: 13 },
				],
			},
		]);
	});

	test('bodies under the token floor are too small to call duplicates', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/billing/formatAmount.ts', formatAmountSource],
				['src/invoices/formatTotal.ts', formatTotalSource],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 200 } });

		expect(findings).toStrictEqual([]);
	});

	test('bodies of different shape are different functions, however alike their names read', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/billing/formatAmount.ts', formatAmountSource],
				['src/invoices/formatNet.ts', formatNetSource],
			],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 5 } });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: { minBodyTokens: 40 } });

		expect(findings).toStrictEqual([]);
	});
	test('never pairs a standards package with the repo around it, since neither copy can import the other', async () => {
		const body = (name: string) =>
			`export const ${name} = ({ text }: { text: string }): string[] =>\n\ttext\n\t\t.replace(/([a-z0-9])([A-Z])/g, '$1 $2')\n\t\t.split(/[\\s\\-_.]+/)\n\t\t.filter(Boolean)\n\t\t.map((token) => token.toLowerCase());\n`;
		const input = setupSyntaxTreeInput({
			sources: [
				['src/common/naming/tokensOf.ts', body('tokensOf')],
				['standards/common/utils/getTokens.ts', body('getTokens')],
			],
			standardsPackages: ['standards'],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 10 } });

		// a package installs where the rest of this repo is absent, so deleting
		// either copy leaves one side importing what is not there
		expect(findings).toStrictEqual([]);
	});

	test('still reports a duplicate pair inside one standards package', async () => {
		const body = (name: string) =>
			`export const ${name} = ({ text }: { text: string }): string[] =>\n\ttext\n\t\t.replace(/([a-z0-9])([A-Z])/g, '$1 $2')\n\t\t.split(/[\\s\\-_.]+/)\n\t\t.filter(Boolean)\n\t\t.map((token) => token.toLowerCase());\n`;
		const input = setupSyntaxTreeInput({
			sources: [
				['standards/common/utils/getTokens.ts', body('getTokens')],
				['standards/common/utils/splitWords.ts', body('splitWords')],
			],
			standardsPackages: ['standards'],
		});

		const findings = await check.run({ input, settings: { minBodyTokens: 10 } });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["'getTokens', 'splitWords' (32 tokens) have identical bodies after identifier normalization"]);
	});
});
