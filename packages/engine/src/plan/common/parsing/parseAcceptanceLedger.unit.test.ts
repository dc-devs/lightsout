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
