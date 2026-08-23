import { describe, expect, test } from '@jest/globals';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { getPlanTouchedPaths } from '#src/plan/common/utils/getPlanTouchedPaths.ts';

interface PlanSpec {
	create?: string[];
	modify?: string[];
	earlierModify?: string[];
	remove?: string[];
	move?: { from: string; to: string }[];
}

/** A parsed plan carrying only the path collections the two size numbers are read from. `PhaseFile['plan']` is the barrel's name for it. */
const setupPlan = ({ create = [], modify = [], earlierModify = [], remove = [], move = [] }: PlanSpec = {}) => {
	const plan: PhaseFile['plan'] = {
		base: 'plan.md',
		title: 'Plan',
		variant: 'implementable',
		sections: new Map(),
		createPaths: create,
		modifyPaths: modify,
		earlierPhaseModifyPaths: earlierModify,
		deletePaths: remove,
		movePaths: move,
		malformedMoveLines: [],
		mirrorPaths: [],
		verificationCommands: [],
		lines: [],
	};

	return { plan };
};

describe('getPlanTouchedPaths', () => {
	test('created counts Files to Create alone, and touched gathers every heading including both sides of a move', () => {
		const { plan } = setupPlan({
			create: ['src/new.ts'],
			modify: ['src/here.ts'],
			earlierModify: ['src/from-phase-one.ts'],
			remove: ['src/gone.ts'],
			move: [{ from: 'src/old/thing.ts', to: 'src/new/thing.ts' }],
		});

		const counts = getPlanTouchedPaths({ plan });

		expect(counts).toStrictEqual({
			created: ['src/new.ts'],
			touched: ['src/new.ts', 'src/here.ts', 'src/from-phase-one.ts', 'src/gone.ts', 'src/old/thing.ts', 'src/new/thing.ts'],
		});
	});

	test('a move destination is touched but never created, because a moved file is already written', () => {
		const { plan } = setupPlan({ move: Array.from({ length: 31 }, (_, index) => ({ from: `src/old/mod${index}.ts`, to: `src/new/mod${index}.ts` })) });

		const counts = getPlanTouchedPaths({ plan });

		// counting a relocation as creation would block a mechanical 31-file move
		// against a ceiling no `## File Budget` can raise
		expect({ created: counts.created.length, touched: counts.touched.length }).toStrictEqual({ created: 0, touched: 62 });
	});

	test('a path named under two headings is counted once', () => {
		const { plan } = setupPlan({ create: ['src/thing.ts'], modify: ['src/thing.ts'], remove: ['src/thing.ts'] });

		const counts = getPlanTouchedPaths({ plan });

		expect(counts).toStrictEqual({ created: ['src/thing.ts'], touched: ['src/thing.ts'] });
	});

	test('tests, barrels and declaration files count toward neither number', () => {
		const { plan } = setupPlan({
			create: ['src/thing.unit.test.ts', 'src/index.ts', 'src/markdown.d.ts', 'src/thing.ts'],
			modify: ['src/plan/index.ts', 'tests/helpers/setup.ts'],
		});

		const counts = getPlanTouchedPaths({ plan });

		// the drafter is told to count exactly this set, so a second spelling here
		// is a second answer to how big the phase is
		expect(counts).toStrictEqual({ created: ['src/thing.ts'], touched: ['src/thing.ts'] });
	});

	test('a plan naming no files at all is zero on both numbers', () => {
		const { plan } = setupPlan();

		const counts = getPlanTouchedPaths({ plan });

		expect(counts).toStrictEqual({ created: [], touched: [] });
	});
});
