import { describe, expect, test } from '@jest/globals';
import { renderProgressBlock } from '#src/cli/common/progressBlock/renderProgressBlock.ts';
import { RunStatus } from '#src/contracts/index.ts';
import type { RunProgressRow } from '#src/views/index.ts';

type BlockParams = Parameters<typeof renderProgressBlock>[0];
type BlockRow = Pick<RunProgressRow, 'id' | 'status' | 'attempts' | 'durationMs'>;

/** The escape byte every ANSI sequence opens with, built rather than written, so no control character sits in this source. */
const escapeByte = String.fromCharCode(27);

/** The same line without its paint, so a painted block can be measured the way a terminal measures it. */
const plain = ({ text }: { text: string }) =>
	text
		.split(escapeByte)
		.map((part) => part.replace(/^\[[0-9;]*m/, ''))
		.join('');

/** A painted line cut at its escape codes, each piece without its code: the plain text before the paint, the painted text, and the plain text after. */
const paintPieces = ({ text }: { text: string }) => text.split(escapeByte).map((part) => part.replace(/^\[[0-9;]*m/, ''));

const passedTwiceRow: BlockRow = { id: 'verify-facts', status: RunStatus.Passed, attempts: 2, durationMs: 30_000 };
const notReachedRow: BlockRow = { id: 'draft', status: undefined, attempts: 0, durationMs: undefined };

/**
 * The block's inputs, with paint off unless a case forces it on. The shared
 * test environment puts `isTTY` back after every test.
 */
const setupBlock = ({ paint = false, ...overrides }: Partial<BlockParams> & { paint?: boolean } = {}): BlockParams => {
	process.stdout.isTTY = paint;

	return {
		title: 'demo',
		tag: 'planning',
		rows: [passedTwiceRow, notReachedRow],
		diagnostics: [],
		totals: 'elapsed 1m 30s · 1 of 5 passed',
		now: 'draft running since 14:02',
		...overrides,
	};
};

describe('renderProgressBlock', () => {
	test('draws the title, rules, rows, totals and now line in that order, with the tag flush to the rule', () => {
		const params = setupBlock();

		const lines = renderProgressBlock(params);

		expect(lines).toStrictEqual([
			`demo${' '.repeat(37)}planning`,
			'─'.repeat(49),
			' ✓  verify-facts         passed (x2)       0m 30s',
			' ·  draft                —',
			'─'.repeat(49),
			' elapsed 1m 30s · 1 of 5 passed',
			' now  draft running since 14:02',
		]);
	});

	test('draws no now line when the now text is undefined', () => {
		const params = setupBlock({ now: undefined });

		const lines = renderProgressBlock(params);

		expect(lines.at(-1)).toBe(' elapsed 1m 30s · 1 of 5 passed');
		expect(lines.filter((line) => line.startsWith(' now'))).toStrictEqual([]);
	});

	test('draws diagnostics between the rows and the closing rule, widening both rules to the widest line', () => {
		const wideDiagnostic = ' diagnosis     the draft step stopped before it wrote a single plan file';
		const narrowDiagnostic = ' hint          rerun plan draft';
		const params = setupBlock({ diagnostics: [wideDiagnostic, narrowDiagnostic] });

		const lines = renderProgressBlock(params);

		const rule = '─'.repeat(wideDiagnostic.length);

		expect(lines.slice(1)).toStrictEqual([
			rule,
			' ✓  verify-facts         passed (x2)       0m 30s',
			' ·  draft                —',
			wideDiagnostic,
			narrowDiagnostic,
			rule,
			' elapsed 1m 30s · 1 of 5 passed',
			' now  draft running since 14:02',
		]);
	});

	test('a not-reached row ends at the em dash and paint touches only the glyph', () => {
		const params = setupBlock({
			paint: true,
			rows: [
				{ id: 'verify-facts', status: RunStatus.Passed, attempts: 1, durationMs: 30_000 },
				notReachedRow,
				// a recorded pending step still carries a clock of zero; the row must not show it
				{ id: 'dedup', status: RunStatus.Pending, attempts: 0, durationMs: 0 },
			],
		});

		const lines = renderProgressBlock(params);

		expect(lines.map((text) => plain({ text }))).toStrictEqual([
			`demo${' '.repeat(37)}planning`,
			'─'.repeat(49),
			' ✓  verify-facts         passed            0m 30s',
			' ·  draft                —',
			' ·  dedup                —',
			'─'.repeat(49),
			' elapsed 1m 30s · 1 of 5 passed',
			' now  draft running since 14:02',
		]);
		// each row is plain text, one painted glyph, then plain text again
		expect(lines.slice(2, 5).map((text) => paintPieces({ text }))).toStrictEqual([
			[' ', '✓', '  verify-facts         passed            0m 30s'],
			[' ', '·', '  draft                —'],
			[' ', '·', '  dedup                —'],
		]);
	});
});
