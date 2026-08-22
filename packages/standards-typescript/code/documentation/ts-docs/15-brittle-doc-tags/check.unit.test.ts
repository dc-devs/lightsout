import { describe, expect, test } from '@jest/globals';
import type { StandardsCheckInput } from '@lightsout/standards-contracts';
import { StandardsInputKind } from '@lightsout/standards-contracts';
import { setupOtherKindInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/** A repo as the engine hands it to a file-text rule: every path in scope, with its text beside it. */
const setupFileTextInput = ({
	contents,
	tests = [],
	standardsPacks = [],
}: {
	contents: Array<[string, string]>;
	tests?: string[];
	standardsPacks?: string[];
}): StandardsCheckInput => {
	const files = contents.map(([path]) => path);

	return {
		kind: StandardsInputKind.FileText,
		cwd: '/repo',
		source: files.filter((file) => !tests.includes(file)),
		tests,
		files,
		referenceFiles: [],
		contents: new Map(contents),
		standardsPacks,
	};
};

/** A file the engine listed in scope but whose text never made it into the run. */
const setupMissingTextInput = (): StandardsCheckInput => ({
	kind: StandardsInputKind.FileText,
	cwd: '/repo',
	source: ['src/billing/chargeInvoice.ts'],
	tests: [],
	files: ['src/billing/chargeInvoice.ts'],
	referenceFiles: [],
	contents: new Map<string, string>(),
	standardsPacks: [],
});

/** One file's doc comment, wrapped in the block the rule reads. */
const setupDocComment = ({ lines, path = 'src/billing/chargeInvoice.ts' }: { lines: string[]; path?: string }) =>
	setupFileTextInput({
		contents: [[path, ['/**', ...lines.map((line) => ` * ${line}`), ' */', 'export const chargeInvoice = (): number => 1;'].join('\n')]],
	});

describe('brittle-doc-tags check', () => {
	test('asks for file text, since the tags it bans are inside the comments', () => {
		expect(check.inputKind).toBe('file-text');
	});

	test('reports a tag git already owns', async () => {
		const input = setupDocComment({ lines: ['Charges an invoice.', '', '@author Ada Lovelace'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'brittle-doc-tags:src/billing/chargeInvoice.ts',
				files: [{ path: 'src/billing/chargeInvoice.ts' }],
				detail: '@author in a doc comment',
				guidance: 'Delete the tag — git, TypeScript and the issue tracker already own what it records.',
			},
		]);
	});

	test.each([
		{ tag: '@version 2.1.0', named: '@version' },
		{ tag: '@since 2.1.0', named: '@since' },
		{ tag: '@type {string}', named: '@type' },
		{ tag: '@default 10', named: '@default' },
		{ tag: '@readonly', named: '@readonly' },
		{ tag: '@private', named: '@private' },
		{ tag: '@public', named: '@public' },
		{ tag: '@protected', named: '@protected' },
		{ tag: '@memberof Billing', named: '@memberof' },
		{ tag: '@todo handle partial payments', named: '@todo' },
	])('reports $named', async ({ tag, named }) => {
		const input = setupDocComment({ lines: [tag] });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe(`${named} in a doc comment`);
	});

	test('reports a tag in a component file, which the document governs the same way', async () => {
		const input = setupDocComment({ lines: ['@author Ada Lovelace'], path: 'src/billing/InvoiceRow.tsx' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'brittle-doc-tags:src/billing/InvoiceRow.tsx',
				files: [{ path: 'src/billing/InvoiceRow.tsx' }],
				detail: '@author in a doc comment',
				guidance: 'Delete the tag — git, TypeScript and the issue tracker already own what it records.',
			},
		]);
	});

	test('reports a see tag pointing at a URL', async () => {
		const input = setupDocComment({ lines: ['@see https://example.com/billing'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('@see with a URL in a doc comment');
	});

	test('names each banned tag once, however often the file repeats it', async () => {
		const input = setupDocComment({ lines: ['@author Ada Lovelace', '@author Grace Hopper', '@todo handle partial payments'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('@author, @todo in a doc comment');
	});

	test('gathers the tags of every doc comment in the file into one finding', async () => {
		const input = setupFileTextInput({
			contents: [
				[
					'src/billing/chargeInvoice.ts',
					[
						'/**',
						' * Charges an invoice.',
						' *',
						' * @author Ada Lovelace',
						' */',
						'export const chargeInvoice = (): number => 1;',
						'',
						'/**',
						' * Refunds an invoice.',
						' *',
						' * @todo handle partial refunds',
						' */',
						'export const refundInvoice = (): number => 1;',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe('@author, @todo in a doc comment');
	});

	test('accepts the tags the elements section asks for', async () => {
		const input = setupDocComment({
			lines: [
				'Charges an invoice.',
				'',
				'@param invoiceId - the invoice to charge',
				'@returns the receipt id',
				'@throws {PaymentDeclinedError} When declined',
				'@example chargeInvoice({ invoiceId })',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts @typeParam, which the word boundary keeps from reading as @type', async () => {
		const input = setupDocComment({ lines: ['@typeParam Row - the row shape the caller reads back'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts the link form the section offers in place of a URL', async () => {
		const input = setupDocComment({ lines: ['@see {@link Invoice}'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts @deprecated, whose ban turns on the migration path beside it rather than the tag', async () => {
		const input = setupDocComment({ lines: ['@deprecated Use chargeOrder instead.'] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a banned tag written in a line comment, which is prose rather than documentation', async () => {
		const input = setupFileTextInput({
			contents: [['src/billing/chargeInvoice.ts', '// @todo handle partial payments\nexport const chargeInvoice = (): number => 1;']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a JavaScript file, where a type tag is how a type is declared at all', async () => {
		const input = setupDocComment({ lines: ['@type {import("jest").Config}'], path: 'tools/jest.config.js' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('ignores a test file, which the test standards govern', async () => {
		const input = setupFileTextInput({
			contents: [['src/billing/chargeInvoice.unit.test.ts', '/**\n * @todo cover the declined path\n */\nexport const setup = (): number => 1;']],
			tests: ['src/billing/chargeInvoice.unit.test.ts'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('inside a declared pack, a rule under tests/ is ordinary source and answers for its tags', async () => {
		const input = setupFileTextInput({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', '/**\n * @author Ada Lovelace\n */\nexport const checkRule = (): number => 1;']],
			standardsPacks: ['standards'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'brittle-doc-tags:standards/tests/unit-testing/10-rule/check.ts',
				files: [{ path: 'standards/tests/unit-testing/10-rule/check.ts' }],
				detail: '@author in a doc comment',
				guidance: 'Delete the tag — git, TypeScript and the issue tracker already own what it records.',
			},
		]);
	});

	test('the same path with no pack declared above it is a tests/ directory the test standards govern', async () => {
		const input = setupFileTextInput({
			contents: [['standards/tests/unit-testing/10-rule/check.ts', '/**\n * @author Ada Lovelace\n */\nexport const checkRule = (): number => 1;']],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports every offending file and leaves the clean ones out', async () => {
		const input = setupFileTextInput({
			contents: [
				['src/billing/chargeInvoice.ts', '/**\n * @author Ada Lovelace\n */\nexport const chargeInvoice = (): number => 1;'],
				['src/billing/listInvoices.ts', '/**\n * @param page - the page to read\n */\nexport const listInvoices = (): number => 1;'],
				['src/billing/refundInvoice.ts', '/**\n * @todo handle partial refunds\n */\nexport const refundInvoice = (): number => 1;'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toEqual([
			expect.objectContaining({ siteKey: 'brittle-doc-tags:src/billing/chargeInvoice.ts', detail: '@author in a doc comment' }),
			expect.objectContaining({ siteKey: 'brittle-doc-tags:src/billing/refundInvoice.ts', detail: '@todo in a doc comment' }),
		]);
	});

	test('reports nothing for a file in scope whose text the run did not carry', async () => {
		const input = setupMissingTextInput();

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
