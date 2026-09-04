import { describe, expect, test } from '@jest/globals';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { getPhaseProvenance } from '#src/plan/common/utils/getPhaseProvenance.ts';

interface PhaseSpec {
	base: string;
	create?: string[];
	remove?: string[];
	move?: { from: string; to: string }[];
}

/** A parsed plan carrying only the four path collections provenance is walked from. `PhaseFile['plan']` is the barrel's name for it. */
const planWith = ({ base, create = [], remove = [], move = [] }: PhaseSpec): PhaseFile['plan'] => ({
	base,
	title: 'Phase',
	variant: 'implementable',
	sections: new Map(),
	createPaths: create,
	modifyPaths: [],
	earlierPhaseModifyPaths: [],
	deletePaths: remove,
	movePaths: move,
	malformedMoveLines: [],
	mirrorPaths: [],
	verificationCommands: [],
	ledger: [],
	malformedLedgerLines: [],
	proseFiles: [],
	malformedProseLines: [],
	lines: [],
});

/** The phases in the order given — which is the order `lintPlanStructure` has already sorted them into. */
const setupPhases = ({ phases }: { phases: PhaseSpec[] }) => ({
	phases: phases.map((spec, index): PhaseFile => ({ path: `/plans/demo/${spec.base}`, base: spec.base, number: index + 1, plan: planWith(spec) })),
});

/** A basename-keyed map of path sets, as plain arrays, so one assertion can pin the whole walk. */
const asLists = ({ map }: { map: Map<string, Set<string>> }): Record<string, string[]> =>
	Object.fromEntries([...map].map(([base, paths]): [string, string[]] => [base, [...paths]]));

describe('getPhaseProvenance', () => {
	test('each phase is handed what strictly earlier phases supplied, never its own creations', () => {
		const { phases } = setupPhases({
			phases: [
				{ base: 'phase1-core.md', create: ['src/core.ts'] },
				{ base: 'phase2-extra.md', create: ['src/extra.ts'] },
			],
		});

		const provenance = getPhaseProvenance({ phases });

		// a phase that read its own creations as already-supplied would flag every
		// file it creates as one an earlier phase already creates
		expect(asLists({ map: provenance.providedBefore })).toStrictEqual({ 'phase1-core.md': [], 'phase2-extra.md': ['src/core.ts'] });
	});

	test('a move supplies its destination and removes its source for every later phase', () => {
		const { phases } = setupPhases({
			phases: [{ base: 'phase1-core.md', move: [{ from: 'src/old.ts', to: 'src/new.ts' }] }, { base: 'phase2-extra.md' }],
		});

		const provenance = getPhaseProvenance({ phases });

		expect({
			provided: asLists({ map: provenance.providedBefore })['phase2-extra.md'],
			removed: asLists({ map: provenance.removedBefore })['phase2-extra.md'],
		}).toStrictEqual({ provided: ['src/new.ts'], removed: ['src/old.ts'] });
	});

	test('a single plan has no predecessor, so both of its sets are empty', () => {
		const { phases } = setupPhases({ phases: [{ base: 'plan.md', create: ['src/new.ts'], remove: ['src/gone.ts'] }] });

		const provenance = getPhaseProvenance({ phases });

		expect({ provided: asLists({ map: provenance.providedBefore }), removed: asLists({ map: provenance.removedBefore }) }).toStrictEqual({
			provided: { 'plan.md': [] },
			removed: { 'plan.md': [] },
		});
	});

	test('the two sets are net rather than cumulative, so a file deleted then recreated is supplied again', () => {
		const { phases } = setupPhases({
			phases: [
				{ base: 'phase1-core.md' },
				{ base: 'phase2-prune.md', remove: ['src/legacy.ts'] },
				{ base: 'phase3-rebuild.md', create: ['src/legacy.ts'] },
				{ base: 'phase4-extend.md' },
			],
		});

		const provenance = getPhaseProvenance({ phases });

		// cumulative sets would have phase 4's modify collide with phase 2's delete
		// and report perfectly ordered work as a defect
		expect({
			provided: asLists({ map: provenance.providedBefore })['phase4-extend.md'],
			removed: asLists({ map: provenance.removedBefore })['phase4-extend.md'],
		}).toStrictEqual({ provided: ['src/legacy.ts'], removed: [] });
	});

	test('a path is attributed to the phase that most recently created and most recently removed it', () => {
		const { phases } = setupPhases({
			phases: [
				{ base: 'phase1-core.md', create: ['src/thing.ts'] },
				{ base: 'phase2-prune.md', remove: ['src/thing.ts'] },
				{ base: 'phase3-rebuild.md', create: ['src/thing.ts'] },
			],
		});

		const provenance = getPhaseProvenance({ phases });

		expect({ createdBy: Object.fromEntries(provenance.createdBy), removedBy: Object.fromEntries(provenance.removedBy) }).toStrictEqual({
			createdBy: { 'src/thing.ts': 'phase3-rebuild.md' },
			removedBy: { 'src/thing.ts': 'phase2-prune.md' },
		});
	});

	test('a deliverable with no implementable phase resolves to an empty provenance', () => {
		const { phases } = setupPhases({ phases: [] });

		const provenance = getPhaseProvenance({ phases });

		expect({
			providedBefore: asLists({ map: provenance.providedBefore }),
			removedBefore: asLists({ map: provenance.removedBefore }),
			createdBy: Object.fromEntries(provenance.createdBy),
			removedBy: Object.fromEntries(provenance.removedBy),
		}).toStrictEqual({ providedBefore: {}, removedBefore: {}, createdBy: {}, removedBy: {} });
	});
});
