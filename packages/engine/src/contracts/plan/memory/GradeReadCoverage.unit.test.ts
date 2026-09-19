import { describe, expect, test } from '@jest/globals';
import { GradeReadCoverage } from '#src/contracts/index.ts';

const setupEntries = () => {
	const unknownLens = {
		file: 'phase1-preflight.md',
		// a brief the current list does not hold — renamed or dropped since the
		// entry was written
		lens: 'retired-brief',
		designSha256: 'a'.repeat(64),
		neighbours: ['phase2-extra.md'],
		at: '2026-09-02T00:00:00.000Z',
	};
	const noNeighbours = {
		file: 'phase2-extra.md',
		lens: 'surface',
		designSha256: 'b'.repeat(64),
		at: '2026-09-02T00:00:00.000Z',
	};

	return { unknownLens, noNeighbours };
};

describe('GradeReadCoverage', () => {
	test('an entry naming an unknown lens parses, and a missing neighbour list defaults to empty', () => {
		const { unknownLens, noNeighbours } = setupEntries();

		const parsed = GradeReadCoverage.array().parse([unknownLens, noNeighbours]);

		// an entry is only ever compared for equality against the current brief
		// list, so a brief renamed since it was written keeps its name verbatim
		// rather than refusing the whole memory file; and an entry written with no
		// neighbour list reads as "the graph joined it to nothing", never as a
		// missing field that rejects the parse
		expect(parsed).toStrictEqual([
			{
				file: 'phase1-preflight.md',
				lens: 'retired-brief',
				designSha256: 'a'.repeat(64),
				neighbours: ['phase2-extra.md'],
				at: '2026-09-02T00:00:00.000Z',
			},
			{
				file: 'phase2-extra.md',
				lens: 'surface',
				designSha256: 'b'.repeat(64),
				neighbours: [],
				at: '2026-09-02T00:00:00.000Z',
			},
		]);
	});
});
