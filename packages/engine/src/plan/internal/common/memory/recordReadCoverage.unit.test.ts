import { describe, expect, test } from '@jest/globals';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import type { GradeDocsCoverage } from '#src/contracts/plan/memory/GradeDocsCoverage.ts';
import type { GradeReadCoverage } from '#src/contracts/plan/memory/GradeReadCoverage.ts';
import { recordReadCoverage } from '#src/plan/internal/common/memory/recordReadCoverage.ts';

/** The arrangement one call to the fold takes, read off the function itself so no second spelling of it can drift. */
type PassParams = Parameters<typeof recordReadCoverage>[0];

/** When an earlier pass recorded what it read, and when the pass under test runs. */
const priorAt = '2026-09-01T00:00:00.000Z';
const passAt = '2026-09-08T00:00:00.000Z';

/** Every plan file the deliverable holds now, at the design text this pass measured. */
const designHashes = new Map([
	['overview.md', 'design-overview'],
	['phase1-regions.md', 'design-phase1'],
	['phase2-hashes.md', 'design-phase2'],
	['phase3-coverage.md', 'design-phase3'],
]);

/** The phase graph as it stands now: phase one hands to phase two, which hands to phase three. */
const phaseGraph = () =>
	new Map([
		['phase1-regions.md', new Set(['phase2-hashes.md'])],
		['phase2-hashes.md', new Set(['phase1-regions.md', 'phase3-coverage.md'])],
		['phase3-coverage.md', new Set(['phase2-hashes.md'])],
	]);

/** One entry as an earlier pass left it. */
const standingOf = ({
	file,
	lens,
	designSha256,
	neighbours,
}: {
	file: string;
	lens: GapCheckLens;
	designSha256: string;
	neighbours: string[];
}): GradeReadCoverage => ({
	file,
	lens,
	designSha256,
	neighbours,
	at: priorAt,
});

/** The documentation checker's entry as an earlier pass left it, naming one plan file at text that has since moved. */
const staleDocs: GradeDocsCoverage = {
	planFiles: [{ file: 'phase1-regions.md', designSha256: 'design-phase1-old' }],
	at: priorAt,
};

/** Reader entries in one settled order, so an assertion pins their content rather than the order the fold happens to return them in. */
const byFileAndLens = ({ readers }: { readers: GradeReadCoverage[] }) =>
	[...readers].sort((a, b) => a.file.localeCompare(b.file) || a.lens.localeCompare(b.lens));

const setupPass = ({
	standing = [],
	docs,
	read = [],
	light = { phases: [], lenses: [] },
	noGraph = false,
	documentationChecked = false,
	narrowed = false,
}: {
	standing?: GradeReadCoverage[];
	docs?: GradeDocsCoverage;
	read?: Array<{ phase: string; lens: GapCheckLens }>;
	light?: { phases: string[]; lenses: string[] };
	noGraph?: boolean;
	documentationChecked?: boolean;
	narrowed?: boolean;
} = {}) => {
	const params: PassParams = {
		standing,
		docs,
		read,
		light,
		designHashes,
		connections: noGraph ? undefined : phaseGraph(),
		documentationChecked,
		narrowed,
		at: passAt,
	};

	return { params };
};

describe('recordReadCoverage', () => {
	test('a pass records one entry per plan file per lens beside what already stood', () => {
		const { params } = setupPass({
			standing: [standingOf({ file: 'phase3-coverage.md', lens: GapCheckLens.Decisions, designSha256: 'design-phase3', neighbours: ['phase2-hashes.md'] })],
			read: [
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Surface },
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Wiring },
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Decisions },
				{ phase: 'phase2-hashes.md', lens: GapCheckLens.Surface },
				{ phase: 'phase2-hashes.md', lens: GapCheckLens.Wiring },
				{ phase: 'phase2-hashes.md', lens: GapCheckLens.Decisions },
			],
		});

		const coverage = recordReadCoverage(params);

		expect(byFileAndLens({ readers: coverage.readers })).toStrictEqual([
			{ file: 'phase1-regions.md', lens: GapCheckLens.Decisions, designSha256: 'design-phase1', neighbours: ['phase2-hashes.md'], at: passAt },
			{ file: 'phase1-regions.md', lens: GapCheckLens.Surface, designSha256: 'design-phase1', neighbours: ['phase2-hashes.md'], at: passAt },
			{ file: 'phase1-regions.md', lens: GapCheckLens.Wiring, designSha256: 'design-phase1', neighbours: ['phase2-hashes.md'], at: passAt },
			{
				file: 'phase2-hashes.md',
				lens: GapCheckLens.Decisions,
				designSha256: 'design-phase2',
				neighbours: ['phase1-regions.md', 'phase3-coverage.md'],
				at: passAt,
			},
			{
				file: 'phase2-hashes.md',
				lens: GapCheckLens.Surface,
				designSha256: 'design-phase2',
				neighbours: ['phase1-regions.md', 'phase3-coverage.md'],
				at: passAt,
			},
			{
				file: 'phase2-hashes.md',
				lens: GapCheckLens.Wiring,
				designSha256: 'design-phase2',
				neighbours: ['phase1-regions.md', 'phase3-coverage.md'],
				at: passAt,
			},
			// the phase this pass never read keeps the entry the earlier pass wrote for it, at the text that pass read
			{ file: 'phase3-coverage.md', lens: GapCheckLens.Decisions, designSha256: 'design-phase3', neighbours: ['phase2-hashes.md'], at: priorAt },
		]);
	});

	test('a lens that returned keeps its entry when a sibling lens failed on the same file', () => {
		const { params } = setupPass({
			read: [
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Surface },
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Wiring },
			],
		});

		const coverage = recordReadCoverage(params);

		// the decisions brief failed on this file, so it holds some-but-not-all lenses and stays uncovered
		expect(byFileAndLens({ readers: coverage.readers })).toStrictEqual([
			{ file: 'phase1-regions.md', lens: GapCheckLens.Surface, designSha256: 'design-phase1', neighbours: ['phase2-hashes.md'], at: passAt },
			{ file: 'phase1-regions.md', lens: GapCheckLens.Wiring, designSha256: 'design-phase1', neighbours: ['phase2-hashes.md'], at: passAt },
		]);
	});

	test('a light file is recorded as covered at its current text', () => {
		const { params } = setupPass({
			read: [],
			light: { phases: ['phase2-hashes.md'], lenses: [GapCheckLens.Surface, GapCheckLens.Wiring, GapCheckLens.Decisions] },
		});

		const coverage = recordReadCoverage(params);

		// no reader read this file, so a full set of entries is written for it at the text the pass weighed
		expect(byFileAndLens({ readers: coverage.readers })).toStrictEqual([
			{
				file: 'phase2-hashes.md',
				lens: GapCheckLens.Decisions,
				designSha256: 'design-phase2',
				neighbours: ['phase1-regions.md', 'phase3-coverage.md'],
				at: passAt,
			},
			{
				file: 'phase2-hashes.md',
				lens: GapCheckLens.Surface,
				designSha256: 'design-phase2',
				neighbours: ['phase1-regions.md', 'phase3-coverage.md'],
				at: passAt,
			},
			{
				file: 'phase2-hashes.md',
				lens: GapCheckLens.Wiring,
				designSha256: 'design-phase2',
				neighbours: ['phase1-regions.md', 'phase3-coverage.md'],
				at: passAt,
			},
		]);
	});

	test('a narrowed pass records nothing and changes nothing', () => {
		const { params } = setupPass({
			standing: [standingOf({ file: 'phase3-coverage.md', lens: GapCheckLens.Decisions, designSha256: 'design-phase3', neighbours: ['phase2-hashes.md'] })],
			docs: staleDocs,
			read: [
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Surface },
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Wiring },
			],
			documentationChecked: true,
			narrowed: true,
		});

		const coverage = recordReadCoverage(params);

		// a human narrowed this pass, so it buys no approval: what stood is handed straight back
		expect(coverage).toStrictEqual({
			readers: [{ file: 'phase3-coverage.md', lens: GapCheckLens.Decisions, designSha256: 'design-phase3', neighbours: ['phase2-hashes.md'], at: priorAt }],
			docs: { planFiles: [{ file: 'phase1-regions.md', designSha256: 'design-phase1-old' }], at: priorAt },
		});
	});

	test('no graph means no entry, even when the readers returned', () => {
		const { params } = setupPass({
			standing: [standingOf({ file: 'phase3-coverage.md', lens: GapCheckLens.Decisions, designSha256: 'design-phase3', neighbours: ['phase2-hashes.md'] })],
			read: [
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Surface },
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Wiring },
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Decisions },
			],
			noGraph: true,
		});

		const coverage = recordReadCoverage(params);

		// an entry with no recorded neighbours could never be invalidated along the graph this pass lost, so none is written
		expect(coverage.readers).toStrictEqual([
			{ file: 'phase3-coverage.md', lens: GapCheckLens.Decisions, designSha256: 'design-phase3', neighbours: ['phase2-hashes.md'], at: priorAt },
		]);
	});

	test('the documentation entry is rewritten only when the checker ran', () => {
		const { params } = setupPass({ docs: staleDocs, documentationChecked: true });

		const recorded = [true, false].map((documentationChecked) => recordReadCoverage({ ...params, documentationChecked }));

		expect(recorded.map(({ docs }) => docs)).toStrictEqual([
			// the checker ran, so its entry names every current plan file at this pass's text and time
			{
				planFiles: [
					{ file: 'overview.md', designSha256: 'design-overview' },
					{ file: 'phase1-regions.md', designSha256: 'design-phase1' },
					{ file: 'phase2-hashes.md', designSha256: 'design-phase2' },
					{ file: 'phase3-coverage.md', designSha256: 'design-phase3' },
				],
				at: passAt,
			},
			// the checker did not run, so the entry handed in comes back untouched
			{ planFiles: [{ file: 'phase1-regions.md', designSha256: 'design-phase1-old' }], at: priorAt },
		]);
	});

	test('a reading of a plan file this pass measured no design text for is not recorded', () => {
		const { params } = setupPass({
			read: [
				{ phase: 'phase1-regions.md', lens: GapCheckLens.Surface },
				// a phase a resplit took out from under the pass: the readers returned for
				// it, but this pass measured no design hash for it
				{ phase: 'phase9-resplit-away.md', lens: GapCheckLens.Surface },
			],
		});

		const coverage = recordReadCoverage(params);

		// an entry carrying no design text could never be compared against the plan's
		// current text, so it would claim a reading nothing can take back
		expect(coverage.readers).toStrictEqual([
			{ file: 'phase1-regions.md', lens: GapCheckLens.Surface, designSha256: 'design-phase1', neighbours: ['phase2-hashes.md'], at: passAt },
		]);
	});

	test('re-reading a phase replaces its entry rather than adding one', () => {
		const { params } = setupPass({
			standing: [standingOf({ file: 'phase1-regions.md', lens: GapCheckLens.Surface, designSha256: 'design-phase1-old', neighbours: ['phase2-hashes.md'] })],
			read: [{ phase: 'phase1-regions.md', lens: GapCheckLens.Surface }],
		});

		const coverage = recordReadCoverage(params);

		// one entry per plan file and lens, carrying this pass's time rather than the earlier one's
		expect(coverage.readers).toStrictEqual([
			{ file: 'phase1-regions.md', lens: GapCheckLens.Surface, designSha256: 'design-phase1', neighbours: ['phase2-hashes.md'], at: passAt },
		]);
	});
});
