import { describe, expect, test } from '@jest/globals';
import type { StandardsFinding } from '#src/contracts/index.ts';
import { type AttributedFindings, attributeStandardsFindings } from '#src/standardsCheck/index.ts';

const finding = (overrides: Partial<StandardsFinding>): StandardsFinding => ({
	rule: 'size-file',
	severity: 'blocking',
	siteKey: 'size-file:src/a.ts',
	files: [{ path: 'src/a.ts' }],
	detail: 'x',
	...overrides,
});

const setupAttribution = ({ live = [], baseline }: { live?: Partial<StandardsFinding>[]; baseline?: Partial<StandardsFinding>[] } = {}) => ({
	live: live.map((overrides) => finding(overrides)),
	baseline: baseline?.map((overrides) => finding(overrides)),
});

const bucketKeys = (attributed: AttributedFindings) => ({
	introduced: attributed.introduced.map((entry) => entry.siteKey),
	worsened: attributed.worsened.map((entry) => entry.siteKey),
	inherited: attributed.inherited.map((entry) => entry.siteKey),
	uncertain: attributed.uncertain.map((entry) => entry.siteKey),
});

describe('attributeStandardsFindings', () => {
	test('a site key the baseline never carried is introduced', () => {
		const { live, baseline } = setupAttribution({
			live: [{ siteKey: 'size-file:src/fresh.ts', files: [{ path: 'src/fresh.ts' }], measure: 320 }],
			baseline: [{ siteKey: 'size-file:src/old.ts', files: [{ path: 'src/old.ts' }], measure: 400 }],
		});

		const attributed = attributeStandardsFindings({ live, baseline });

		// a violation the baseline never saw is the run's own, and no other bucket
		// may absorb it
		expect(bucketKeys(attributed)).toStrictEqual({
			introduced: ['size-file:src/fresh.ts'],
			worsened: [],
			inherited: [],
			uncertain: [],
		});
	});

	test('a larger live measure at a known site is worsened', () => {
		const { live, baseline } = setupAttribution({
			live: [
				{ siteKey: 'size-file:src/grew.ts', files: [{ path: 'src/grew.ts' }], measure: 15 },
				{ siteKey: 'size-file:src/same.ts', files: [{ path: 'src/same.ts' }], measure: 15 },
			],
			baseline: [
				{ siteKey: 'size-file:src/grew.ts', files: [{ path: 'src/grew.ts' }], measure: 12 },
				{ siteKey: 'size-file:src/same.ts', files: [{ path: 'src/same.ts' }], measure: 15 },
			],
		});

		const attributed = attributeStandardsFindings({ live, baseline });

		// 12 -> 15 is growth the run caused; 15 -> 15 is the same violation being
		// reported a second time and buys nothing
		expect(bucketKeys(attributed)).toStrictEqual({
			introduced: [],
			worsened: ['size-file:src/grew.ts'],
			inherited: ['size-file:src/same.ts'],
			uncertain: [],
		});
		// the bucketed entry is the LIVE finding, not the baseline one it matched:
		// the executor is handed this object as work, so it has to carry today's
		// measurement rather than the tree's earlier one
		expect(attributed.worsened[0]).toEqual(expect.objectContaining({ measure: 15 }));
	});

	test('an equal or smaller live measure at a known site is inherited', () => {
		const { live, baseline } = setupAttribution({
			live: [
				{ siteKey: 'size-file:src/equal.ts', files: [{ path: 'src/equal.ts' }], measure: 10 },
				{ siteKey: 'size-file:src/shrank.ts', files: [{ path: 'src/shrank.ts' }], measure: 8 },
			],
			baseline: [
				{ siteKey: 'size-file:src/equal.ts', files: [{ path: 'src/equal.ts' }], measure: 10 },
				{ siteKey: 'size-file:src/shrank.ts', files: [{ path: 'src/shrank.ts' }], measure: 20 },
			],
		});

		const attributed = attributeStandardsFindings({ live, baseline });

		// debt that stood still, and debt the run made smaller, are both the
		// repository's — neither is handed back as work
		expect(bucketKeys(attributed)).toStrictEqual({
			introduced: [],
			worsened: [],
			inherited: ['size-file:src/equal.ts', 'size-file:src/shrank.ts'],
			uncertain: [],
		});
		// recorded as the live read: the shrunk site reports today's 8, not the
		// baseline's 20, so the report cannot overstate what is still standing
		expect(attributed.inherited.map((entry) => entry.measure)).toStrictEqual([10, 8]);
	});

	test('a site with no measure on both sides is uncertain', () => {
		const { live, baseline } = setupAttribution({
			live: [
				{ rule: 'crowded-folder', siteKey: 'crowded-folder:src/appUI', files: [{ path: 'src/appUI' }] },
				{ siteKey: 'size-file:src/liveOnly.ts', files: [{ path: 'src/liveOnly.ts' }], measure: 9 },
				{ siteKey: 'size-file:src/baselineOnly.ts', files: [{ path: 'src/baselineOnly.ts' }] },
			],
			baseline: [
				{ rule: 'crowded-folder', siteKey: 'crowded-folder:src/appUI', files: [{ path: 'src/appUI' }] },
				{ siteKey: 'size-file:src/liveOnly.ts', files: [{ path: 'src/liveOnly.ts' }] },
				{ siteKey: 'size-file:src/baselineOnly.ts', files: [{ path: 'src/baselineOnly.ts' }], measure: 9 },
			],
		});

		const attributed = attributeStandardsFindings({ live, baseline });

		// a comparison needs a number on both sides: no number at all, and a
		// number on one side only, are the same absence of evidence
		expect(bucketKeys(attributed)).toStrictEqual({
			introduced: [],
			worsened: [],
			inherited: [],
			uncertain: ['crowded-folder:src/appUI', 'size-file:src/liveOnly.ts', 'size-file:src/baselineOnly.ts'],
		});
	});

	test('a missing baseline puts every live finding in uncertain', () => {
		const { live, baseline } = setupAttribution({
			live: [
				{ siteKey: 'size-file:src/a.ts', files: [{ path: 'src/a.ts' }], measure: 400 },
				{ rule: 'crowded-folder', siteKey: 'crowded-folder:src/appUI', files: [{ path: 'src/appUI' }] },
			],
		});

		const attributed = attributeStandardsFindings({ live, baseline });

		// with no comparison point, calling a finding new would be a guess — the
		// run records what it cannot know instead of inventing provenance
		expect(bucketKeys(attributed)).toStrictEqual({
			introduced: [],
			worsened: [],
			inherited: [],
			uncertain: ['size-file:src/a.ts', 'crowded-folder:src/appUI'],
		});
	});
});
