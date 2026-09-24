import { describe, expect, test } from '@jest/globals';
import { setupOtherKindInput, setupTestFileInput } from '@lightsout/standards-testkit';
import { check } from './check.ts';

const path = 'src/workOrder/createWorkOrder.unit.test.ts';

const guidance =
	"To say a key is absent, drop it from the matcher and compare `Object.hasOwn(value, 'key')` against `false`; to say its value is undefined either way, assert `value.key` with `toBe(undefined)`.";

/** A suite whose one test runs the assertion given — the assertion sits on line 3. */
const buildAssertionSource = ({ assertion }: { assertion: string }) =>
	["describe('subject', () => {", "\ttest('reads the record back', () => {", `\t\t${assertion}`, '\t});', '});'].join('\n');

/** The assertion LO-158 shipped: it reads as "and ticketRef is absent", and fails against every record read from disk. */
const readBackAssertion =
	"expect(readRecord({ cwd, name: 'add-search-basics' })).toEqual(expect.objectContaining({ name: 'add-search-basics', ticketRef: undefined }));";

/** A matcher spread over several lines, pairing two of its keys with undefined — the keys sit on lines 4 and 6. */
const multiLineSource = [
	"describe('subject', () => {",
	"\ttest('reads the record back', () => {",
	'\t\texpect(record).toEqual(expect.objectContaining({',
	'\t\t\tticketRef: undefined,',
	"\t\t\tname: 'add-search-basics',",
	"\t\t\t'branch-name': undefined,",
	'\t\t}));',
	'\t});',
	'});',
].join('\n');

describe('test-never-passing-assertion check', () => {
	test('asks for test files — the input that carries every test file in the repository, changed or not', () => {
		expect(check.inputKind).toBe('test-file');
	});

	test('reports expect.objectContaining pairing a key with undefined, naming the file, the line and why it cannot pass', async () => {
		const input = setupTestFileInput({ contents: [[path, buildAssertionSource({ assertion: readBackAssertion })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([
			{
				siteKey: 'test-never-passing-assertion:src/workOrder/createWorkOrder.unit.test.ts',
				files: [{ path: 'src/workOrder/createWorkOrder.unit.test.ts', startLine: 3, endLine: 3 }],
				detail:
					'expect.objectContaining pairs a key with undefined, which requires the key to be present — an object without it, such as one read back from JSON, never matches: `ticketRef` at line 3',
				guidance,
			},
		]);
	});

	test('names each key on its own line when the matcher spans several, quoted keys included', async () => {
		const input = setupTestFileInput({ contents: [[path, multiLineSource]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => ({ files: finding.files, detail: finding.detail }))).toStrictEqual([
			{
				files: [
					{ path, startLine: 4, endLine: 4 },
					{ path, startLine: 6, endLine: 6 },
				],
				detail:
					'expect.objectContaining pairs a key with undefined, which requires the key to be present — an object without it, such as one read back from JSON, never matches: `ticketRef` at line 4, `branch-name` at line 6',
			},
		]);
	});

	test.each([
		{ form: 'absence through Object.hasOwn', assertion: "expect(Object.hasOwn(record, 'ticketRef')).toBe(false);" },
		{ form: 'the value alone', assertion: 'expect(record.ticketRef).toBe(undefined);' },
		{
			form: 'a whole-object toEqual, which treats a key holding undefined as absent',
			assertion: "expect(record).toEqual({ name: 'a', ticketRef: undefined });",
		},
		{ form: 'a nested object, compared by plain equality', assertion: 'expect(record).toEqual(expect.objectContaining({ meta: { ticketRef: undefined } }));' },
		{ form: 'a value merely named like undefined', assertion: 'expect(record).toEqual(expect.objectContaining({ ticketRef: undefinedRef }));' },
		{ form: 'a quoted mention of the banned form', assertion: "expect(sample).toContain('expect.objectContaining({ ticketRef: undefined })');" },
	])('leaves $form alone — it states the intent in a form that can pass', async ({ assertion }) => {
		const input = setupTestFileInput({ contents: [[path, buildAssertionSource({ assertion })]] });

		const findings = await check.run({ input, settings: {} });

		expect(findings).toStrictEqual([]);
	});

	test('reads every test file it is handed, reporting each on its own', async () => {
		const otherPath = 'src/plan/parsePlan.unit.test.ts';
		const input = setupTestFileInput({
			contents: [
				[path, buildAssertionSource({ assertion: readBackAssertion })],
				[otherPath, buildAssertionSource({ assertion: readBackAssertion })],
			],
		});

		const findings = await check.run({ input, settings: {} });

		expect(findings.map((finding) => finding.siteKey)).toStrictEqual([
			'test-never-passing-assertion:src/workOrder/createWorkOrder.unit.test.ts',
			'test-never-passing-assertion:src/plan/parsePlan.unit.test.ts',
		]);
	});

	test('reports nothing for an input of any other kind rather than refusing', async () => {
		const findings = await check.run({ input: setupOtherKindInput(), settings: {} });

		expect(findings).toStrictEqual([]);
	});
});
