import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const setupOneFile = ({ text }: { text: string }) => setupSyntaxTreeInput({ sources: [['src/billing/chargeInvoice.ts', text]] });

describe('single-use-scalar check', () => {
	test('asks for parsed trees, since it must tell a bare scalar from a lookup map and then count its readers', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports a module-scope number that one place reads', async () => {
		const input = setupOneFile({
			text: 'const maxRetries = 10;\n\nexport const chargeInvoice = ({ attempt }: { attempt: number }): boolean => attempt < maxRetries;\n',
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'single-use-scalar:src/billing/chargeInvoice.ts',
				files: [{ path: 'src/billing/chargeInvoice.ts' }],
				detail: "'maxRetries' is declared at module scope and read once",
				guidance: 'Declare it inside the function that reads it — module scope is for values read in 2+ places, lookup maps and structured config.',
			},
		]);
	});

	test.each([
		{ kind: 'a string', initializer: "'paid'" },
		{ kind: 'a template with no substitutions', initializer: '`paid`' },
		{ kind: 'a true boolean', initializer: 'true' },
		{ kind: 'a false boolean', initializer: 'false' },
		{ kind: 'a negative number', initializer: '-1' },
	])('reports $kind as a scalar too', async ({ initializer }) => {
		const input = setupOneFile({ text: `const marker = ${initializer};\n\nexport const chargeInvoice = (): string => \`\${marker}\`;\n` });

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'marker' is declared at module scope and read once");
	});

	test('gathers every hoisted scalar of one file into one job', async () => {
		const input = setupOneFile({
			text: ['const maxRetries = 10;', "const label = 'charge';", '', 'export const chargeInvoice = (): string => `${label}${maxRetries}`;'].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'maxRetries', 'label' are declared at module scope and read once");
	});

	test('reads every name of one `const` statement, so a shared declaration hides nothing', async () => {
		const input = setupOneFile({
			text: ["const maxRetries = 10, label = 'charge';", '', 'export const chargeInvoice = (): string => `${label}${maxRetries}`;'].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'maxRetries', 'label' are declared at module scope and read once");
	});

	test('finds the hoisted scalar of a file whose other statements declare no variable at all', async () => {
		const input = setupOneFile({
			text: [
				"import { getRate } from './getRate.ts';",
				'',
				'const maxRetries = 10;',
				'',
				'export function chargeInvoice({ attempt }: { attempt: number }): boolean {',
				'\treturn attempt < maxRetries && getRate() > 0;',
				'}',
			].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'maxRetries' is declared at module scope and read once");
	});

	test('answers per file across a repo, so one file’s hoisted scalar never taints a neighbour that reads its own twice', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/chargeInvoice.ts',
					'const maxRetries = 10;\n\nexport const chargeInvoice = ({ attempt }: { attempt: number }): boolean => attempt < maxRetries;\n',
				],
				[
					'src/billing/retryCharge.ts',
					[
						'const maxAttempts = 3;',
						'',
						'const isFinalAttempt = ({ attempt }: { attempt: number }) => attempt >= maxAttempts;',
						'',
						'export const retryCharge = ({ attempt }: { attempt: number }): boolean => attempt < maxAttempts && !isFinalAttempt({ attempt });',
					].join('\n'),
				],
				['src/billing/refundInvoice.ts', "const label = 'refund';\n\nexport const refundInvoice = (): string => label;\n"],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'single-use-scalar:src/billing/chargeInvoice.ts',
				files: [{ path: 'src/billing/chargeInvoice.ts' }],
				detail: "'maxRetries' is declared at module scope and read once",
				guidance: 'Declare it inside the function that reads it — module scope is for values read in 2+ places, lookup maps and structured config.',
			},
			{
				siteKey: 'single-use-scalar:src/billing/refundInvoice.ts',
				files: [{ path: 'src/billing/refundInvoice.ts' }],
				detail: "'label' is declared at module scope and read once",
				guidance: 'Declare it inside the function that reads it — module scope is for values read in 2+ places, lookup maps and structured config.',
			},
		]);
	});

	test('counts readers per file, so a name one file declares and another mentions is still read once', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				['src/billing/chargeInvoice.ts', 'const maxRetries = 10;\n\nexport const chargeInvoice = (): number => maxRetries;\n'],
				['src/billing/retryCharge.ts', 'export const retryCharge = ({ maxRetries }: { maxRetries: number }): number => maxRetries;\n'],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'single-use-scalar:src/billing/chargeInvoice.ts',
				files: [{ path: 'src/billing/chargeInvoice.ts' }],
				detail: "'maxRetries' is declared at module scope and read once",
				guidance: 'Declare it inside the function that reads it — module scope is for values read in 2+ places, lookup maps and structured config.',
			},
		]);
	});

	test('leaves a scalar declared inside the function that reads it', async () => {
		const input = setupOneFile({
			text: [
				'export const chargeInvoice = ({ attempt }: { attempt: number }): boolean => {',
				'\tconst maxRetries = 10;',
				'',
				'\treturn attempt < maxRetries;',
				'};',
			].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a constant two places read, which is what earns module scope', async () => {
		const input = setupOneFile({
			text: [
				'const maxAttempts = 3;',
				'',
				'const isFinalAttempt = ({ attempt }: { attempt: number }) => attempt >= maxAttempts;',
				'',
				'export const chargeInvoice = ({ attempt }: { attempt: number }): boolean => attempt < maxAttempts && !isFinalAttempt({ attempt });',
			].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a lookup map, which the rule names as a carve-out', async () => {
		const input = setupOneFile({
			text: ["const chargeLabels: Record<string, string> = { paid: 'Paid' };", '', 'export const chargeInvoice = (): string => chargeLabels.paid ?? "";'].join(
				'\n',
			),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a computed value, since the rule speaks about bare scalars rather than anything with moving parts', async () => {
		const input = setupOneFile({
			text: [
				'const retryFlags = { skip: false };',
				'const isRetryable = !retryFlags.skip;',
				'',
				'export const chargeInvoice = (): boolean => isRetryable;',
			].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a destructured binding, which names no single value to move into its reader', async () => {
		const input = setupOneFile({
			text: ["const { paid: paidLabel } = { paid: 'Paid' };", '', 'export const chargeInvoice = (): string => paidLabel;'].join('\n'),
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an ambient declaration, which holds no value of its own to move anywhere', async () => {
		const input = setupOneFile({ text: 'declare const maxRetries: number;\n\nexport const chargeInvoice = (): number => maxRetries;\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an exported constant, whose readers are in other files this one cannot count', async () => {
		const input = setupOneFile({ text: 'export const maxRetries = 10;\n\nexport const chargeInvoice = (): number => maxRetries;\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a scalar nothing reads — an unread constant is dead code with a different fix', async () => {
		const input = setupOneFile({ text: 'const maxRetries = 10;\n\nexport const chargeInvoice = (): number => 1;\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a `let`, which is state rather than a hoisted constant', async () => {
		const input = setupOneFile({ text: 'let attempts = 0;\n\nexport const chargeInvoice = (): number => attempts;\n' });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
