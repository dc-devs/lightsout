import { describe, expect, test } from '@jest/globals';
import { buildSprawlLayout } from '#src/features/sprawl/common/rendering/buildSprawlLayout.ts';

const caps = { file: 250, tsxFile: 300, function: 80, testFile: 400, folderCensus: 3 };

/**
 * A layout over a hand-written state rather than the committed dataset: an
 * expectation read off real history would have to be rewritten every time this
 * repository gains a commit.
 */
const setupLayout = ({
	files = {},
	folders = {},
	maxLines = 400,
}: {
	files?: Record<string, number>;
	folders?: Record<string, number>;
	maxLines?: number;
} = {}) =>
	buildSprawlLayout({
		state: { files: new Map(Object.entries(files)), folders: new Map(Object.entries(folders)), overCap: 0 },
		maxLines,
		caps,
		width: 100,
		height: 20,
	});

describe('buildSprawlLayout', () => {
	test('orders the bars biggest first, so the tallest file is the one a reader looks at', () => {
		const layout = setupLayout({ files: { 'a.ts': 10, 'b.ts': 200, 'c.ts': 50 } });

		expect(layout.bars.map((bar) => bar.path)).toStrictEqual(['b.ts', 'c.ts', 'a.ts']);
	});

	test('breaks a tie by path, so one state always draws in one order', () => {
		const layout = setupLayout({ files: { 'z.ts': 10, 'a.ts': 10 } });

		expect(layout.bars.map((bar) => bar.path)).toStrictEqual(['a.ts', 'z.ts']);
	});

	test('draws at most forty bars, because a hairline per file is noise', () => {
		const files = Object.fromEntries(Array.from({ length: 60 }, (_unused, index) => [`file${index}.ts`, index]));

		expect(setupLayout({ files }).bars).toHaveLength(40);
	});

	test('measures a bar against the all-frames maximum, so the scale never moves between frames', () => {
		const layout = setupLayout({ files: { 'a.ts': 200 }, maxLines: 400 });

		// Half the tallest file ever seen, in the top 70% of a 20-unit box.
		expect(layout.bars[0].height).toBeCloseTo(7);
		expect(layout.bars[0].y).toBeCloseTo(7);
	});

	test('gives every bar an equal share of the width', () => {
		const layout = setupLayout({ files: { 'a.ts': 1, 'b.ts': 2 } });

		expect(layout.bars.map((bar) => bar.x)).toStrictEqual([0, 2.5]);
		expect(layout.bars[0].width).toBe(2.5);
	});

	test('holds a .tsx file to the wider cap the standards give it', () => {
		const layout = setupLayout({ files: { 'a.tsx': 280, 'b.ts': 280 } });

		expect(layout.bars.map((bar) => bar.overCap)).toStrictEqual([false, true]);
	});

	test('puts the cap line where a file of exactly the cap would reach', () => {
		expect(setupLayout({ files: { 'a.ts': 1 }, maxLines: 500 }).capY).toBeCloseTo(7);
	});

	test('floors every bar and the cap line on an empty history rather than dividing by nothing', () => {
		const layout = setupLayout({ files: { 'a.ts': 0 }, maxLines: 0 });

		expect(layout.bars[0].height).toBe(0);
		expect(layout.capY).toBe(14);
	});

	test('draws the fullest folders as rows, biggest first, eight at most', () => {
		const folders = Object.fromEntries(Array.from({ length: 12 }, (_unused, index) => [`dir${index}`, index]));
		const layout = setupLayout({ folders });

		expect(layout.folderRows).toHaveLength(8);
		expect(layout.folderRows[0].path).toBe('dir11');
	});

	test('gives a folder one square per direct file, and stacks the rows below the bars', () => {
		const layout = setupLayout({ folders: { one: 2, two: 1 } });

		expect(layout.folderRows[0].squares).toHaveLength(2);
		expect(layout.folderRows[0].squares[1].x).toBeCloseTo(0.5625);
		expect(layout.folderRows[1].y).toBeGreaterThan(layout.folderRows[0].y);
	});

	test('flags a folder over the census cap and puts the census line at that count', () => {
		const layout = setupLayout({ folders: { crowded: 5, calm: 2 } });

		expect(layout.folderRows.map((row) => row.overCap)).toStrictEqual([true, false]);
		expect(layout.censusX).toBeCloseTo(1.6875);
	});
});
