import { describe, expect, test } from '@jest/globals';
import { setupSyntaxTreeInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

/**
 * The edges of the decorator-metadata exemption: which declaration carries the
 * decorator, and how far into a type the emitted value reaches. The suite lives
 * beside `check.unit.test.ts` rather than inside it because that file is at the
 * test-file cap.
 */
const setupSource = ({ path = 'src/events/events.controller.ts', lines }: { path?: string; lines: string[] }) =>
	setupSyntaxTreeInput({ sources: [[path, `${lines.join('\n')}\n`]] });

describe('import-type-only check', () => {
	test('leaves a namespace import alone when a decorated constructor names its type through a qualified name', async () => {
		const input = setupSource({
			path: 'src/events/events.service.ts',
			lines: [
				"import * as orm from './orm';",
				'',
				'@Injectable()',
				'export class EventsService {',
				'\tconstructor(private readonly rows: orm.Repository) {}',
				'}',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves an undecorated method’s parameter type alone when the parameter itself is decorated', async () => {
		const input = setupSource({
			lines: [
				"import { CreateEventDto } from './CreateEventDto';",
				'',
				'@Controller()',
				'export class EventsController {',
				'\tcreate(@Body() dto: CreateEventDto): string {',
				'\t\treturn `${dto}`;',
				'\t}',
				'}',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('leaves a decorated method’s parameter type alone even on an undecorated class, since the method emits its own paramtypes', async () => {
		const input = setupSource({
			lines: [
				"import { CreateEventDto } from './CreateEventDto';",
				'',
				'export class EventsController {',
				'\t@Post()',
				'\tcreate(dto: CreateEventDto): string {',
				'\t\treturn `${dto}`;',
				'\t}',
				'}',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reports an undecorated property’s type inside a decorated class, since no `design:type` is emitted for it', async () => {
		const input = setupSource({
			path: 'src/events/EventRow.ts',
			lines: ["import { EventDate } from './EventDate';", '', '@Entity()', 'export class EventRow {', '\tat: EventDate;', '}'],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["'./EventDate' is used only in type positions"]);
	});

	test('reports a type argument of a decorated property’s type, since the metadata carries the outer constructor alone', async () => {
		const input = setupSource({
			path: 'src/events/EventRow.ts',
			lines: [
				"import { Nullable } from './Nullable';",
				"import { EventDate } from './EventDate';",
				'',
				'@Entity()',
				'export class EventRow {',
				'\t@Column()',
				'\tat: Nullable<EventDate>;',
				'}',
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map(({ detail }) => detail)).toStrictEqual(["'./EventDate' is used only in type positions"]);
	});
});
