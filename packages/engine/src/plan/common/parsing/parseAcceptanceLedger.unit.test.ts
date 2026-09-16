import { describe, expect, test } from '@jest/globals';
import { LedgerRow } from '#src/contracts/index.ts';
import { parseAcceptanceLedger } from '#src/plan/common/parsing/parseAcceptanceLedger.ts';

/** The header and rule every ledger table opens with — furniture the parser skips rather than reads. */
const header = ['| Criterion | Test file | Test name | Gate |', '|-----------|-----------|-----------|------|'];

/** The section as it sits in a plan file: the table under the heading, numbered from line 20. */
const parse = ({ rows }: { rows: string[] }) => parseAcceptanceLedger({ sectionLines: ['', ...header, ...rows], firstLine: 20 });

describe('parseAcceptanceLedger', () => {
	test('reads a row into its four fields, numbered by where it sits in the plan file', () => {
		const { rows, malformedLines } = parse({ rows: ['| the weight is light | `src/w.unit.test.ts` | a light file | check |'] });

		expect(rows).toStrictEqual([{ criterion: 'the weight is light', testFile: 'src/w.unit.test.ts', testName: 'a light file', gate: 'check', line: 23 }]);
		expect(malformedLines).toStrictEqual([]);
	});

	test('a blank gate cell means the test gate, which is the ledger’s common case', () => {
		const { rows } = parse({ rows: ['| it parses | `src/a.unit.test.ts` | it parses |  |'] });

		expect(rows[0]?.gate).toBe('test');
	});

	test('a row with only a gate column omitted still takes the test gate', () => {
		const { rows } = parse({ rows: ['| it parses | `src/a.unit.test.ts` | it parses |'] });

		expect(rows[0]?.gate).toBe('test');
	});

	test('the header row and the rule beneath it contribute neither a row nor a malformed line', () => {
		expect(parse({ rows: [] })).toStrictEqual({ rows: [], malformedLines: [] });
	});

	test('a row with fewer than three filled cells is reported by line rather than dropped', () => {
		// a criterion the parser loses silently is a criterion nothing ever checks
		const { rows, malformedLines } = parse({ rows: ['| it parses | `src/a.unit.test.ts` |  |  |'] });

		expect(rows).toStrictEqual([]);
		expect(malformedLines).toStrictEqual([23]);
	});

	test('a test-file cell holding no backticked span is malformed', () => {
		const { rows, malformedLines } = parse({ rows: ['| it parses | src/a.unit.test.ts | it parses | test |'] });

		expect(rows).toStrictEqual([]);
		expect(malformedLines).toStrictEqual([23]);
	});

	test('a backticked span holding only spaces names no test file, so the row is malformed', () => {
		const { rows, malformedLines } = parse({ rows: ['| it parses | `   ` | it parses | test |'] });

		expect(rows).toStrictEqual([]);
		expect(malformedLines).toStrictEqual([23]);
	});

	test('a bare pipe carries no cell at all, so it is neither a row nor a malformed one', () => {
		expect(parse({ rows: ['|'] })).toStrictEqual({ rows: [], malformedLines: [] });
	});

	test('prose written above or below the table is skipped, not read as a row', () => {
		const { rows, malformedLines } = parse({ rows: ['Every criterion below is stated by a test.', '| it parses | `src/a.unit.test.ts` | it parses | test |'] });

		expect(rows.map(({ line }) => line)).toStrictEqual([24]);
		expect(malformedLines).toStrictEqual([]);
	});

	test('a row it returns is one the LedgerRow contract accepts — every field filled, the line a positive number', () => {
		const { rows } = parse({ rows: ['| the ledger is read | `src/plan/parsePlan.unit.test.ts` | reads the ledger | test |'] });

		const checked = LedgerRow.safeParse(rows[0]);

		expect(checked.success).toBe(true);
	});

	test('an absent section yields no rows and nothing malformed', () => {
		expect(parseAcceptanceLedger({ sectionLines: undefined, firstLine: 1 })).toStrictEqual({ rows: [], malformedLines: [] });
	});
});

test('parseAcceptanceLedger retains escaped pipes, newlines, code characters and literal entity text in exact test identity', () => {
	const line = '| keeps \\ and \\| characters | `src/retry.unit.test.ts` | &#32;keeps&#124;after&#10;failure&#96; &amp;#10; &lt;x&gt;&#13;&#32; | test |';

	const parsed = parseAcceptanceLedger({ sectionLines: [line], firstLine: 7 });

	expect(parsed).toEqual({
		rows: [
			{ criterion: 'keeps \\ and | characters', testFile: 'src/retry.unit.test.ts', testName: ' keeps|after\nfailure` &#10; <x>\r ', gate: 'test', line: 7 },
		],
		malformedLines: [],
	});
});

test('parseAcceptanceLedger preserves a real criterion named Criterion instead of mistaking it for table furniture', () => {
	const line = '| Criterion | `src/a.unit.test.ts` | preserves the criterion | test |';

	const parsed = parseAcceptanceLedger({ sectionLines: [line], firstLine: 3 });

	expect(parsed).toEqual({
		rows: [{ criterion: 'Criterion', testFile: 'src/a.unit.test.ts', testName: 'preserves the criterion', gate: 'test', line: 3 }],
		malformedLines: [],
	});
});

test('parseAcceptanceLedger reads a row without a closing border and retains a final escaped pipe as test identity', () => {
	const parsed = parseAcceptanceLedger({
		sectionLines: ['| Criterion | Test file | Test name', '| criterion | `src/a.unit.test.ts` | ends with \\|'],
		firstLine: 1,
	});

	expect(parsed).toEqual({
		rows: [{ criterion: 'criterion', testFile: 'src/a.unit.test.ts', testName: 'ends with |', gate: 'test', line: 2 }],
		malformedLines: [],
	});
});

test('parseAcceptanceLedger preserves all encoded boundary whitespace and backticks inside the file span', () => {
	const line =
		'| &#160;criterion&#8232; | `&#32;src/a&#96;b&#124;&amp;#9;.unit.test.ts&#9;` | &#9;&#11;&#12;&#160;&#5760;&#8192;&#8193;&#8194;&#8195;&#8196;&#8197;&#8198;&#8199;&#8200;&#8201;&#8202;&#8232;&#8233;&#8239;&#8287;&#12288;&#65279; | test |';

	const parsed = parseAcceptanceLedger({ sectionLines: ['<!-- lightsout:text-encoding=entities-v1 -->', line], firstLine: 3 });

	expect(parsed).toEqual({
		rows: [
			{
				criterion: '\u00a0criterion\u2028',
				testFile: ' src/a`b|&#9;.unit.test.ts\t',
				testName: '\t\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff',
				gate: 'test',
				line: 4,
			},
		],
		malformedLines: [],
	});
});

test('parseAcceptanceLedger retains newly supported literal entities in unmarked legacy tables', () => {
	const parsed = parseAcceptanceLedger({ sectionLines: ['| keep&#9; | `src/literal&#9;.ts` | name&#160; | test |'], firstLine: 1 });
	expect(parsed.rows).toEqual([{ criterion: 'keep&#9;', testFile: 'src/literal&#9;.ts', testName: 'name&#160;', gate: 'test', line: 1 }]);
});
test('parseAcceptanceLedger reports an unmatched file span in encoded tables', () => {
	const parsed = parseAcceptanceLedger({
		sectionLines: ['<!-- lightsout:text-encoding=entities-v1 -->', '| retained | `src/open&#96;.ts | named test | test |'],
		firstLine: 1,
	});
	expect(parsed).toEqual({ rows: [], malformedLines: [2] });
});
