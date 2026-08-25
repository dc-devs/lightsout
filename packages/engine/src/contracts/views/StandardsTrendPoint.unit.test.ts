import { describe, expect, test } from '@jest/globals';
import { StandardsTrendPoint } from '#src/contracts/index.ts';

const setupPoint = ({ omit, extra = {} }: { omit?: string; extra?: Record<string, unknown> } = {}) => {
	const point: Record<string, unknown> = {
		at: '2026-08-19T10:15:30.123Z',
		path: '.',
		total: 7,
		blocking: 5,
		advisory: 2,
		byRule: [
			{ rule: 'duplicate-code-block', count: 4 },
			{ rule: 'size-file', count: 3 },
		],
		...extra,
	};

	if (omit) {
		delete point[omit];
	}

	return { point };
};

describe('StandardsTrendPoint', () => {
	test('a dated snapshot reduced to its counts parses with every count intact', () => {
		const { point } = setupPoint();

		const parsed = StandardsTrendPoint.parse(point);

		expect(parsed).toStrictEqual({
			at: '2026-08-19T10:15:30.123Z',
			path: '.',
			total: 7,
			blocking: 5,
			advisory: 2,
			byRule: [
				{ rule: 'duplicate-code-block', count: 4 },
				{ rule: 'size-file', count: 3 },
			],
		});
	});

	test('a clean check parses as zeros with an empty per-rule list', () => {
		const { point } = setupPoint({ extra: { total: 0, blocking: 0, advisory: 0, byRule: [] } });

		const parsed = StandardsTrendPoint.parse(point);

		// a repo with nothing open still plots a point — the trend's whole value is
		// the line reaching zero, so an empty check must not be refused
		expect(parsed).toStrictEqual({ at: '2026-08-19T10:15:30.123Z', path: '.', total: 0, blocking: 0, advisory: 0, byRule: [] });
	});

	test('a check scoped to a subpath keeps the subpath verbatim', () => {
		const { point } = setupPoint({ extra: { path: 'packages/engine' } });

		const parsed = StandardsTrendPoint.parse(point);

		// two points are only comparable when they covered the same subpath, so the
		// scope rides every point rather than being assumed to be the whole repo
		expect(parsed.path).toBe('packages/engine');
	});

	test('every field is required', () => {
		for (const field of ['at', 'path', 'total', 'blocking', 'advisory', 'byRule']) {
			const { point } = setupPoint({ omit: field });

			const result = StandardsTrendPoint.safeParse(point);

			// ${field} is plotted or grouped by directly — an absent one would render as
			// a gap in the chart rather than as a value
			expect(result.success).toBe(false);
		}
	});

	test('rejects counts given as numeric strings rather than coercing them', () => {
		for (const extra of [{ total: '7' }, { blocking: '5' }, { advisory: '2' }]) {
			const { point } = setupPoint({ extra });

			const result = StandardsTrendPoint.safeParse(point);

			// counts are summed and compared across points; a string would order as
			// text and concatenate rather than add
			expect(result.success).toBe(false);
		}
	});

	test('rejects a timestamp or a path that is not a string', () => {
		for (const extra of [{ at: 1_755_600_930_123 }, { path: ['.'] }]) {
			const { point } = setupPoint({ extra });

			const result = StandardsTrendPoint.safeParse(point);

			// the timestamp is what the trend sorts by and the path is what it groups
			// by — both are read as text
			expect(result.success).toBe(false);
		}
	});

	test('rejects a per-rule list that is not an array', () => {
		const { point } = setupPoint({ extra: { byRule: { 'duplicate-code-block': 4 } } });

		const result = StandardsTrendPoint.safeParse(point);

		// a keyed object in place of the list is the shape a reader would have to
		// guess at — the ordered list is the contract
		expect(result.success).toBe(false);
	});

	test('rejects a per-rule entry missing its rule id or its count', () => {
		for (const byRule of [[{ count: 4 }], [{ rule: 'duplicate-code-block' }]]) {
			const { point } = setupPoint({ extra: { byRule } });

			const result = StandardsTrendPoint.safeParse(point);

			// an entry is a pair — either half alone names nothing a chart can label
			expect(result.success).toBe(false);
		}
	});

	test('rejects a per-rule entry whose count is not a number', () => {
		const { point } = setupPoint({ extra: { byRule: [{ rule: 'duplicate-code-block', count: '4' }] } });

		const result = StandardsTrendPoint.safeParse(point);

		expect(result.success).toBe(false);
	});

	test('a rule id any standards package declares is a value a per-rule entry may carry', () => {
		const { point } = setupPoint({ extra: { byRule: [{ rule: 'house-style-no-default-export', count: 1 }] } });

		const parsed = StandardsTrendPoint.parse(point);

		// rule identity belongs to the loaded packages — a trend point holds whatever
		// id the snapshot recorded, including one from a third-party package
		expect(parsed.byRule).toStrictEqual([{ rule: 'house-style-no-default-export', count: 1 }]);
	});

	test('keys the contract does not declare are stripped from the point and from each per-rule entry', () => {
		const { point } = setupPoint({ extra: { notes: ['skipped a corrupt file'], byRule: [{ rule: 'duplicate-code-block', count: 4, severity: 'blocking' }] } });

		const parsed = StandardsTrendPoint.parse(point);

		// the point is counts only — a whole snapshot's notes and severities would
		// defeat the reason the trend stores counts rather than snapshots
		expect(parsed).toStrictEqual({
			at: '2026-08-19T10:15:30.123Z',
			path: '.',
			total: 7,
			blocking: 5,
			advisory: 2,
			byRule: [{ rule: 'duplicate-code-block', count: 4 }],
		});
	});
});
