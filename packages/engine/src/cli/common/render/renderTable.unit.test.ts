import { describe, expect, test } from '@jest/globals';
import { renderTable } from '#src/cli/common/render/renderTable.ts';

describe('renderTable', () => {
	test('sizes every column to its widest cell, header included', () => {
		const lines = renderTable({ headers: ['detector', 'n'], rows: [{ cells: ['module-boundary', '1'] }] });
		const borders = lines.filter((line) => line.startsWith('┌') || line.startsWith('└')).map((line) => line.length);

		expect(new Set(borders).size).toBe(1);
		expect(lines[0]?.length).toBe(' module-boundary '.length + ' n '.length + 3);
	});

	test('left-aligns the first column and right-aligns the rest', () => {
		const lines = renderTable({ headers: ['name', 'count'], rows: [{ cells: ['size', '4'] }] });

		expect(lines.find((line) => line.includes('size'))).toBe('│ size │     4 │');
	});

	test('rules the header off even when the first row asks for no rule above it', () => {
		const lines = renderTable({
			headers: ['a'],
			rows: [
				{ cells: ['one'], ruleAbove: false },
				{ cells: ['two'], ruleAbove: false },
			],
		});

		// the header is always separated; ruleAbove governs only the gaps between rows
		expect(lines).toStrictEqual(['┌─────┐', '│ a   │', '├─────┤', '│ one │', '│ two │', '└─────┘']);
	});

	test('rules between rows by default, so a totals line stands apart', () => {
		const lines = renderTable({ headers: ['a'], rows: [{ cells: ['one'], ruleAbove: false }, { cells: ['total'] }] });

		expect(lines.filter((line) => line.startsWith('├')).length).toBe(2);
	});

	test('applies row emphasis to the cells but leaves a dash plain', () => {
		const lines = renderTable({ headers: ['a', 'b'], rows: [{ cells: ['total', '—'], emphasis: (text) => `<${text}>` }] });

		expect(lines.find((line) => line.includes('total'))).toBe('│< total >│ — │');
	});

	test('measures geometry before painting, so a coloured cell does not shift the column', () => {
		const esc = '';
		const plain = renderTable({ headers: ['a'], rows: [{ cells: ['one'] }] });
		const painted = renderTable({ headers: ['a'], rows: [{ cells: ['one'], paintCell: ({ padded }) => `${esc}[2m${padded}${esc}[0m` }] });
		const stripped = painted.map((line) => line.replaceAll(`${esc}[2m`, '').replaceAll(`${esc}[0m`, ''));

		// an ANSI code is invisible on screen but counts toward String.length, so
		// padding measured on painted text would widen the cell it decorates
		expect(stripped).toStrictEqual(plain);
	});
});
