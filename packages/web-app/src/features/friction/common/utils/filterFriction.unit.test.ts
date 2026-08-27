import { describe, expect, test } from '@jest/globals';
import type { FrictionArea, FrictionRecord } from '@lightsout/engine';
import { filterFriction } from '#src/features/friction/index.ts';
import { buildFrictionRecord } from '#tests/helpers/buildFrictionRecord.ts';

/** Three entries that differ in area, kind and wording, so one filter can only match one of them. */
const setupFilter = ({
	areas = [],
	text,
	records = [
		buildFrictionRecord({ area: 'plan', kind: 'friction', detail: 'the plan named a file that is not on disk', step: 'implement' }),
		buildFrictionRecord({ area: 'environment', kind: 'decision', detail: 'chose the narrower barrel', step: 'write-tests' }),
		buildFrictionRecord({ area: 'standards', detail: 'The Standards contradicted the repo', step: 'refactor' }),
	],
}: {
	areas?: FrictionArea[];
	text?: string;
	records?: FrictionRecord[];
} = {}) => {
	const kept = filterFriction({ records, areas, text });

	return { kept };
};

describe('filterFriction', () => {
	test('shows every entry when no area is picked, since an empty selection is no filter rather than no rows', () => {
		const { kept } = setupFilter({ areas: [] });

		expect(kept).toHaveLength(3);
	});

	test('keeps only the entries filed under the area a reader picked', () => {
		const { kept } = setupFilter({ areas: ['plan'] });

		expect(kept.map((record) => record.area)).toStrictEqual(['plan']);
	});

	test('keeps the entries of every area a reader picked, because the chips narrow to a set', () => {
		const { kept } = setupFilter({ areas: ['plan', 'standards'] });

		expect(kept.map((record) => record.area)).toStrictEqual(['plan', 'standards']);
	});

	test('matches the words an agent wrote in the detail', () => {
		const { kept } = setupFilter({ text: 'narrower barrel' });

		expect(kept.map((record) => record.detail)).toStrictEqual(['chose the narrower barrel']);
	});

	test('matches the kind as well, so a reader can ask for the guesses alone', () => {
		const { kept } = setupFilter({ text: 'decision' });

		expect(kept.map((record) => record.detail)).toStrictEqual(['chose the narrower barrel']);
	});

	test('ignores case on both sides, since nobody types a detail back exactly as it was written', () => {
		const { kept } = setupFilter({ text: 'standards CONTRADICTED' });

		expect(kept.map((record) => record.step)).toStrictEqual(['refactor']);
	});

	test('reads a blank box as no text filter, rather than as a search for a space', () => {
		const { kept } = setupFilter({ text: '   ' });

		expect(kept).toHaveLength(3);
	});

	test('leaves an entry that named no kind in the results, matching on its detail alone', () => {
		const { kept } = setupFilter({ text: 'contradicted' });

		expect(kept.map((record) => record.kind)).toStrictEqual([undefined]);
	});

	test('narrows by both at once, so the text search applies inside the chosen areas', () => {
		const { kept } = setupFilter({ areas: ['plan'], text: 'barrel' });

		expect(kept).toStrictEqual([]);
	});

	test('returns nothing when a search matches no entry, rather than falling back to the whole log', () => {
		const { kept } = setupFilter({ text: 'a phrase nobody wrote' });

		expect(kept).toStrictEqual([]);
	});

	test('reads only the entry itself, never the run it came from, so a filter does not wait on the runs query', () => {
		const { kept } = setupFilter({ text: 'abcdef01' });

		expect(kept).toStrictEqual([]);
	});
});
