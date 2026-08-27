import { describe, expect, test } from '@jest/globals';
import { getDemoRunListings } from '#src/lightsout/common/utils/getDemoRunListings.ts';
import { getDemoRunViews } from '#src/lightsout/common/utils/getDemoRunViews.ts';

describe('getDemoRunListings', () => {
	test('carries a row for each of the three frozen runs', () => {
		const listings = getDemoRunListings();

		expect(listings).toHaveLength(3);
	});

	test('names the same three runs the frozen views do, so the runs list and the proof section cannot disagree', () => {
		const rows = getDemoRunListings()
			.map((listing) => listing.runId)
			.sort();
		const views = Object.values(getDemoRunViews())
			.map((view) => view.listing.runId)
			.sort();

		expect(rows).toStrictEqual(views);
	});

	test('is newest first, the order the runs list wants', () => {
		const updatedAt = getDemoRunListings().map((listing) => listing.updatedAt);

		expect(updatedAt).toStrictEqual([...updatedAt].sort().reverse());
	});

	test('parses once and hands the same array back', () => {
		expect(getDemoRunListings()).toBe(getDemoRunListings());
	});
});
