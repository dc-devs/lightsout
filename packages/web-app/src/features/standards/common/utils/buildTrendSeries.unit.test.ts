import { describe, expect, test } from '@jest/globals';
import type { StandardsTrendPoint } from '@lightsout/engine';
import { buildTrendSeries } from '#src/features/standards/index.ts';

const point = ({ at, total, blocking }: { at: string; total: number; blocking: number }): StandardsTrendPoint => ({
	at,
	path: '.',
	total,
	blocking,
	advisory: total - blocking,
	byRule: [],
});

const ascending = [
	point({ at: '2026-01-01T00:00:00.000Z', total: 0, blocking: 0 }),
	point({ at: '2026-01-02T00:00:00.000Z', total: 5, blocking: 2 }),
	point({ at: '2026-01-03T00:00:00.000Z', total: 10, blocking: 4 }),
];

describe('buildTrendSeries', () => {
	test('has nothing to draw for a repo that has never run a check', () => {
		const series = buildTrendSeries({ points: [] });

		expect(series).toBeUndefined();
	});

	test('refuses to draw a single snapshot as a line, since one point states no direction', () => {
		const series = buildTrendSeries({ points: [point({ at: '2026-01-01T00:00:00.000Z', total: 10, blocking: 4 })] });

		expect(series).toBeUndefined();
	});

	test('spreads the points evenly across the box and measures each height down from the peak', () => {
		const series = buildTrendSeries({ points: ascending });

		expect(series?.total).toBe('M0.0000,1.0000 L0.5000,0.5000 L1.0000,0.0000');
	});

	test('measures the blocking line against the same peak, so the two lines stay comparable', () => {
		const series = buildTrendSeries({ points: ascending });

		expect(series?.blocking).toBe('M0.0000,1.0000 L0.5000,0.8000 L1.0000,0.6000');
	});

	test('labels the span with the first and last timestamps and the highest count plotted', () => {
		const series = buildTrendSeries({ points: ascending });

		expect(series).toMatchObject({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z', peak: 10 });
	});

	test('draws a run of clean checks along the floor rather than dividing by a peak of zero', () => {
		const series = buildTrendSeries({
			points: [point({ at: '2026-01-01T00:00:00.000Z', total: 0, blocking: 0 }), point({ at: '2026-01-02T00:00:00.000Z', total: 0, blocking: 0 })],
		});

		expect(series).toMatchObject({ total: 'M0.0000,1.0000 L1.0000,1.0000', blocking: 'M0.0000,1.0000 L1.0000,1.0000', peak: 0 });
	});

	test('draws an unchanged count as a level line, which is what a flat series is', () => {
		const series = buildTrendSeries({
			points: [point({ at: '2026-01-01T00:00:00.000Z', total: 12, blocking: 3 }), point({ at: '2026-01-02T00:00:00.000Z', total: 12, blocking: 3 })],
		});

		expect(series?.total).toBe('M0.0000,0.0000 L1.0000,0.0000');
	});
});
