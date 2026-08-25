import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

describe('import-type-only check', () => {
	test('asks for parsed trees, since the verdict is about where each reference sits', () => {
		expect(check.inputKind).toBe('syntax-tree');
	});

	test('reports an import whose only reference is a type annotation', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import { Invoice } from './Invoice';\n\nexport const getChargeLabel = ({ invoice }: { invoice: Invoice }): string => invoice.label;\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'import-type-only:src/billing/getChargeLabel.ts',
				files: [{ path: 'src/billing/getChargeLabel.ts' }],
				detail: "'./Invoice' is used only in type positions",
				guidance: 'Write it as `import type` so it erases at compile time.',
			},
		]);
	});

	test('names every type-only import of one file, since the fix is one pass over its import block', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					[
						"import { Invoice } from './Invoice';",
						"import { Money } from './Money';",
						'',
						'export const getChargeLabel = ({ invoice, amount }: { invoice: Invoice; amount: Money }): string => `${invoice.label}${amount}`;',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'./Invoice', './Money' are used only in type positions");
	});

	test('accepts an import already written as `import type`', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import type { Invoice } from './Invoice';\n\nexport const getChargeLabel = ({ invoice }: { invoice: Invoice }): string => invoice.label;\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('accepts a clause whose named specifier already carries its own `type` keyword', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import { type Invoice, formatAmount } from './billing';\n\nexport const getChargeLabel = ({ invoice }: { invoice: Invoice }): string => formatAmount({ invoice });\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an import that is called alone', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import { formatAmount } from './formatAmount';\n\nexport const getChargeLabel = ({ amount }: { amount: number }): string => formatAmount({ amount });\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a mixed clause alone, where one binding is still called', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import { Invoice, formatAmount } from './billing';\n\nexport const getChargeLabel = ({ invoice }: { invoice: Invoice }): string => formatAmount({ invoice });\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a default import whose only reference is a type annotation', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import Invoice from './Invoice';\n\nexport const getChargeLabel = ({ invoice }: { invoice: Invoice }): string => invoice.label;\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'import-type-only:src/billing/getChargeLabel.ts',
				files: [{ path: 'src/billing/getChargeLabel.ts' }],
				detail: "'./Invoice' is used only in type positions",
				guidance: 'Write it as `import type` so it erases at compile time.',
			},
		]);
	});

	test('reports a namespace import every reference of which sits in a type', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import * as billing from './billing';\n\nexport const getChargeLabel = ({ invoice }: { invoice: billing.Invoice }): string => invoice.label;\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'./billing' is used only in type positions");
	});

	test('leaves a namespace import alone when the namespace is still read as a value', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import * as billing from './billing';\n\nexport const getChargeLabel = ({ invoice }: { invoice: billing.Invoice }): string => billing.formatAmount({ invoice });\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a side-effect import alone, since it binds no name to rewrite', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/billing/getChargeLabel.ts', "import './registerFormats';\n\nexport const getChargeLabel = (): string => 'label';\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports each offending file on its own and passes over the files that are clean', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/formatAmount.ts',
					"import { round } from './round';\n\nexport const formatAmount = ({ amount }: { amount: number }): string => `${round({ amount })}`;\n",
				],
				[
					'src/billing/getChargeLabel.ts',
					"import { Invoice } from './Invoice';\n\nexport const getChargeLabel = ({ invoice }: { invoice: Invoice }): string => invoice.label;\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'import-type-only:src/billing/getChargeLabel.ts',
				files: [{ path: 'src/billing/getChargeLabel.ts' }],
				detail: "'./Invoice' is used only in type positions",
				guidance: 'Write it as `import type` so it erases at compile time.',
			},
		]);
	});

	test('leaves an import nothing references at all — an unused import is a different fault with a different fix', async () => {
		const input = setupSyntaxTreeInput({
			sources: [['src/billing/getChargeLabel.ts', "import { Invoice } from './Invoice';\n\nexport const getChargeLabel = (): string => 'label';\n"]],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reads `typeof X` as a type position, which is the form `import type` still permits', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/billing/getChargeLabel.ts',
					"import { invoiceShape } from './invoiceShape';\n\nexport const getChargeLabel = (shape: typeof invoiceShape): string => `${shape}`;\n",
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings[0]?.detail).toBe("'./invoiceShape' is used only in type positions");
	});

	test('leaves a decorated class’s constructor-injected dependency alone, which DI resolves from the emitted metadata', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/events/events.controller.ts',
					[
						"import { EventsService } from './events.service';",
						'',
						'@Controller()',
						'export class EventsController {',
						'\tconstructor(private readonly events: EventsService) {}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a decorated method’s parameter type alone, which the validation pipe reads the same way', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/events/events.controller.ts',
					[
						"import { CreateEventDto } from './CreateEventDto';",
						'',
						'@Controller()',
						'export class EventsController {',
						'\t@Post()',
						'\tcreate(@Body() dto: CreateEventDto): string {',
						'\t\treturn `${dto}`;',
						'\t}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a decorated property’s type alone, which is emitted as `design:type`', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/events/EventRow.ts',
					["import { EventDate } from './EventDate';", '', '@Entity()', 'export class EventRow {', '\t@Column()', '\tat: EventDate;', '}'].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a decorated method’s return type alone, which is emitted as `design:returntype`', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/events/events.controller.ts',
					[
						"import { EventDto } from './EventDto';",
						'',
						'@Controller()',
						'export class EventsController {',
						'\t@Get()',
						'\tgetOne(): EventDto {',
						'\t\treturn this.one;',
						'\t}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports a type argument nested inside an exempted position, since the metadata carries the outer constructor alone', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/events/events.service.ts',
					[
						"import { Repository } from './Repository';",
						"import { Event } from './Event';",
						'',
						'@Injectable()',
						'export class EventsService {',
						'\tconstructor(private readonly rows: Repository<Event>) {}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["'./Event' is used only in type positions"]);
	});

	test('reports the same constructor shape on an undecorated class, so the exemption is the decorated declaration rather than the shape', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/events/events.controller.ts',
					[
						"import { EventsService } from './events.service';",
						'',
						'export class EventsController {',
						'\tconstructor(private readonly events: EventsService) {}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["'./events.service' is used only in type positions"]);
	});

	test('reports a name used only in an undecorated member of a decorated class — the line is what metadata is emitted for', async () => {
		const input = setupSyntaxTreeInput({
			sources: [
				[
					'src/events/events.controller.ts',
					[
						"import { EventDto } from './EventDto';",
						'',
						'@Controller()',
						'export class EventsController {',
						'\ttoDto(): EventDto {',
						'\t\treturn this.one;',
						'\t}',
						'}',
					].join('\n'),
				],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["'./EventDto' is used only in type positions"]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
