import { describe, expect, test } from '@jest/globals';
import type { FrictionRecord } from '@lightsout/engine';
import { FrictionArea } from '@lightsout/engine/contracts';
import { countFrictionByArea } from '#src/features/friction/index.ts';
import { buildFrictionRecord } from '#tests/helpers/buildFrictionRecord.ts';

const setupCounts = ({ records = [] }: { records?: FrictionRecord[] } = {}) => {
	const counts = countFrictionByArea({ records });

	return { counts };
};

describe('countFrictionByArea', () => {
	// The five labels spelled out rather than read back from the enum: the chip
	// row's order is the contract, and comparing the map to itself would pass
	// however the areas happened to be ordered.
	test('lists every area the taxonomy has, in the order it declares them', () => {
		const { counts } = setupCounts({ records: [buildFrictionRecord({ area: FrictionArea.Other })] });

		const areas = counts.map((entry) => entry.area);

		expect(areas).toStrictEqual(['plan', 'prompt', 'standards', 'environment', 'other']);
	});

	test('keeps an area nothing was reported under at zero, so a chip never moves as the log grows', () => {
		const { counts } = setupCounts({ records: [buildFrictionRecord({ area: FrictionArea.Plan })] });

		expect(counts).toStrictEqual([
			{ area: 'plan', count: 1 },
			{ area: 'prompt', count: 0 },
			{ area: 'standards', count: 0 },
			{ area: 'environment', count: 0 },
			{ area: 'other', count: 0 },
		]);
	});

	test('counts every entry filed under an area, whatever kind each one was', () => {
		const { counts } = setupCounts({
			records: [
				buildFrictionRecord({ area: FrictionArea.Plan, kind: 'friction' }),
				buildFrictionRecord({ area: FrictionArea.Plan, kind: 'decision' }),
				buildFrictionRecord({ area: FrictionArea.Environment }),
			],
		});

		const byArea = Object.fromEntries(counts.map((entry) => [entry.area, entry.count]));

		expect(byArea).toStrictEqual({ plan: 2, prompt: 0, standards: 0, environment: 1, other: 0 });
	});

	test('answers an empty log with every area at zero rather than with no chips at all', () => {
		const { counts } = setupCounts();

		const total = counts.reduce((sum, entry) => sum + entry.count, 0);

		expect(counts).toHaveLength(5);
		expect(total).toBe(0);
	});
});
