import { describe, expect, test } from '@jest/globals';
import { GradeDocsCoverage } from '#src/contracts/index.ts';

const setupDocsCoverage = () => {
	const entry = {
		planFiles: [
			{ file: 'overview.md', designSha256: 'a'.repeat(64) },
			{ file: 'phase1-preflight.md', designSha256: 'b'.repeat(64) },
			{ file: 'phase2-readers.md', designSha256: 'c'.repeat(64) },
		],
		at: '2026-09-02T00:00:00.000Z',
	};
	const entryWithoutFileList = { at: '2026-09-01T00:00:00.000Z' };

	return { entry, entryWithoutFileList };
};

describe('GradeDocsCoverage', () => {
	test('a documentation entry round-trips, and one with no file list defaults to empty', () => {
		const { entry, entryWithoutFileList } = setupDocsCoverage();

		const parsed = GradeDocsCoverage.parse(entry);
		const parsedWithoutFileList = GradeDocsCoverage.parse(entryWithoutFileList);

		// the next pass decides whether the documentation checker still stands by
		// comparing this file list against the plan's current design hashes, so a
		// dropped file or a dropped digest would grant an A on a check that never
		// read that file — and an entry naming nothing must come back naming
		// nothing, never an invented list that compares equal to the current plan
		expect({ parsed, parsedWithoutFileList }).toStrictEqual({
			parsed: {
				planFiles: [
					{ file: 'overview.md', designSha256: 'a'.repeat(64) },
					{ file: 'phase1-preflight.md', designSha256: 'b'.repeat(64) },
					{ file: 'phase2-readers.md', designSha256: 'c'.repeat(64) },
				],
				at: '2026-09-02T00:00:00.000Z',
			},
			parsedWithoutFileList: { planFiles: [], at: '2026-09-01T00:00:00.000Z' },
		});
	});
});
