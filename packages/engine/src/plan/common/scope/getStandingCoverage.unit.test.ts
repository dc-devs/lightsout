import { describe, expect, test } from '@jest/globals';
import { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import type { GradeDocsCoverage } from '#src/contracts/plan/memory/GradeDocsCoverage.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import type { GradeReadCoverage } from '#src/contracts/plan/memory/GradeReadCoverage.ts';
import { getStandingCoverage } from '#src/plan/common/scope/getStandingCoverage.ts';

/** When the recorded pass read the plan, and when the documentation checker last ran. */
const readAt = '2026-01-01T00:00:00.000Z';

/** Every reader brief a plan file must hold an entry for before it counts as covered. */
const lenses = [GapCheckLens.Surface, GapCheckLens.Wiring, GapCheckLens.Decisions];

/** A plan file's design hash while nothing about its text has moved. */
const hashOf = ({ file }: { file: string }): string => `design-${file}`;

/** One reader brief's recorded reading of one plan file. */
const entryOf = ({
	file,
	lens,
	designSha256 = hashOf({ file }),
	neighbours = [],
}: {
	file: string;
	lens: string;
	designSha256?: string;
	neighbours?: string[];
}): GradeReadCoverage => ({ file, lens, designSha256, neighbours, at: readAt });

/** Every brief's reading of one plan file, unless `briefs` names fewer. */
const entriesFor = ({
	file,
	designSha256,
	neighbours,
	briefs = lenses,
}: {
	file: string;
	designSha256?: string;
	neighbours?: string[];
	briefs?: string[];
}): GradeReadCoverage[] => briefs.map((lens) => entryOf({ file, lens, designSha256, neighbours }));

/** The whole-plan documentation checker's own entry, over the files it read at the text it read them at. */
const docsOf = ({ files }: { files: string[] }): GradeDocsCoverage => ({
	planFiles: files.map((file) => ({ file, designSha256: hashOf({ file }) })),
	at: readAt,
});

/** A symmetric adjacency map, the shape `getPhaseConnections` returns: every edge is recorded on both of its phases. */
const connectionsOf = ({ edges, isolated }: { edges: [string, string][]; isolated: string[] }): Map<string, Set<string>> => {
	const connections = new Map<string, Set<string>>();

	const link = ({ from, to }: { from: string; to: string }): void => {
		const neighbours = connections.get(from) ?? new Set<string>();
		neighbours.add(to);
		connections.set(from, neighbours);
	};

	for (const [left, right] of edges) {
		link({ from: left, to: right });
		link({ from: right, to: left });
	}

	for (const base of isolated) {
		connections.set(base, connections.get(base) ?? new Set<string>());
	}

	return connections;
};

interface CoverageSpec {
	/** The reader entries the memory holds, in record order. */
	readers?: GradeReadCoverage[];
	/** The documentation entry the memory holds; absent when the checker has never run. */
	docs?: GradeDocsCoverage;
	/** The implementable plan files readers cover. The overview is never among them. */
	phaseFiles?: string[];
	/** Plan files whose design hash has moved since the entries were written, and the hash they carry now. */
	moved?: Record<string, string>;
	/** The overview, present in the design hashes only, because the documentation entry covers it. */
	withOverview?: boolean;
	edges?: [string, string][];
	otherInputChanged?: boolean;
	seeds?: string[];
}

/**
 * The coverage the memory holds and the plan as it stands now. By default every
 * plan file is at the text its entries were written against, nothing outside the
 * plan text has moved, and the caller places no file as lost.
 */
const setupCoverage = ({
	readers = [],
	docs,
	phaseFiles = ['phase1-core.md', 'phase2-extra.md'],
	moved = {},
	withOverview = false,
	edges = [],
	otherInputChanged = false,
	seeds,
}: CoverageSpec = {}) => {
	const hashed = withOverview ? ['overview.md', ...phaseFiles] : phaseFiles;
	const designHashes = new Map(hashed.map((file) => [file, moved[file] ?? hashOf({ file })]));
	const coverage: GradeMemory['coverage'] = { readers, ...(docs === undefined ? {} : { docs }) };

	return {
		coverage,
		designHashes,
		phaseFiles,
		lenses,
		connections: connectionsOf({ edges, isolated: phaseFiles }),
		otherInputChanged,
		...(seeds === undefined ? {} : { seeds }),
	};
};

describe('getStandingCoverage', () => {
	test('a phase at its recorded design hash is covered, and one whose hash moved is not', () => {
		// phase1 has not been touched since it was read; phase2's design text moved,
		// and the two share no edge, so neither can reach the other
		const params = setupCoverage({
			readers: [...entriesFor({ file: 'phase1-core.md' }), ...entriesFor({ file: 'phase2-extra.md' })],
			moved: { 'phase2-extra.md': 'design-rewritten' },
		});

		const standing = getStandingCoverage(params);

		// an edited phase is never reported as already read, and its stale entries
		// stand for nothing
		expect(standing).toEqual({
			readers: entriesFor({ file: 'phase1-core.md' }),
			covered: ['phase1-core.md'],
			invalidated: ['phase2-extra.md'],
			docs: undefined,
		});
	});

	test('an added brief leaves the earlier entries standing and seeds nothing', () => {
		// phase1 was read under two briefs before a third was added; phase2 holds
		// every brief's entry and is joined to phase1 by the phase graph
		const handed = [
			...entriesFor({ file: 'phase1-core.md', briefs: [GapCheckLens.Surface, GapCheckLens.Wiring], neighbours: ['phase2-extra.md'] }),
			...entriesFor({ file: 'phase2-extra.md', neighbours: ['phase1-core.md'] }),
		];
		const params = setupCoverage({ readers: handed, edges: [['phase1-core.md', 'phase2-extra.md']] });

		const standing = getStandingCoverage(params);

		// a brief added since the last pass re-runs only itself: phase1 owes the
		// third reading, its two earlier readings are kept, and its neighbour keeps
		// the coverage it already has
		expect(standing).toEqual({
			readers: handed,
			covered: ['phase2-extra.md'],
			invalidated: ['phase1-core.md'],
			docs: undefined,
		});
	});

	test('a non-plan-text change stands no coverage at all', () => {
		// every design hash matches and the documentation checker has run, but a
		// prompt, the standards, the config or the model moved since the recording
		const params = setupCoverage({
			readers: [...entriesFor({ file: 'phase1-core.md' }), ...entriesFor({ file: 'phase2-extra.md' })],
			docs: docsOf({ files: ['overview.md', 'phase1-core.md', 'phase2-extra.md'] }),
			withOverview: true,
			otherInputChanged: true,
		});

		const standing = getStandingCoverage(params);

		// a reading taken under different instructions is no reading of this plan,
		// so nothing it produced may stay in place
		expect(standing).toEqual({
			readers: [],
			covered: [],
			invalidated: ['phase1-core.md', 'phase2-extra.md'],
			docs: undefined,
		});
	});

	test('a caller-placed seed invalidates that phase and its closure', () => {
		// a changed decision row names phase2; phase2 is joined to phase3, and no
		// plan file's own design text moved
		const phaseFiles = ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'];
		const params = setupCoverage({
			phaseFiles,
			readers: [
				...entriesFor({ file: 'phase1-core.md' }),
				...entriesFor({ file: 'phase2-extra.md', neighbours: ['phase3-final.md'] }),
				...entriesFor({ file: 'phase3-final.md', neighbours: ['phase2-extra.md'] }),
			],
			edges: [['phase2-extra.md', 'phase3-final.md']],
			seeds: ['phase2-extra.md'],
		});

		const standing = getStandingCoverage(params);

		// a decision change that moves no plan text still forces the reading it
		// needs, and reaches the phase on the far side of the edge
		expect(standing).toEqual({
			readers: entriesFor({ file: 'phase1-core.md' }),
			covered: ['phase1-core.md'],
			invalidated: ['phase2-extra.md', 'phase3-final.md'],
			docs: undefined,
		});
	});

	test('a plan file no reader has ever read seeds the closure', () => {
		// a repair added phase3 and joined it to phase2; phase1 stands apart
		const phaseFiles = ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'];
		const params = setupCoverage({
			phaseFiles,
			readers: [...entriesFor({ file: 'phase1-core.md' }), ...entriesFor({ file: 'phase2-extra.md' })],
			edges: [['phase2-extra.md', 'phase3-final.md']],
		});

		const standing = getStandingCoverage(params);

		// a phase nobody has read hands work forward, so its neighbour's reading is
		// examined again rather than trusted
		expect(standing).toEqual({
			readers: entriesFor({ file: 'phase1-core.md' }),
			covered: ['phase1-core.md'],
			invalidated: ['phase2-extra.md', 'phase3-final.md'],
			docs: undefined,
		});
	});

	test('the documentation entry stands only while every plan file is at its recorded text', () => {
		// the checker read the overview and both phases, and nothing has moved since
		const read = docsOf({ files: ['overview.md', 'phase1-core.md', 'phase2-extra.md'] });
		const unchanged = setupCoverage({ docs: read, withOverview: true });

		const atRecordedText = getStandingCoverage(unchanged);

		expect(atRecordedText.docs).toStrictEqual(read);

		// the same entry, against a plan whose second phase has been rewritten since
		const rewritten = setupCoverage({ docs: read, withOverview: true, moved: { 'phase2-extra.md': 'design-rewritten' } });

		const afterAnEdit = getStandingCoverage(rewritten);

		expect(afterAnEdit.docs).toBeUndefined();

		// and against a plan a repair has since added a third phase to, which the
		// entry names nowhere
		const grown = setupCoverage({ docs: read, withOverview: true, phaseFiles: ['phase1-core.md', 'phase2-extra.md', 'phase3-final.md'] });

		const afterAPhaseWasAdded = getStandingCoverage(grown);

		// an A is never granted having not run the documentation checker since the
		// plan changed
		expect(afterAPhaseWasAdded.docs).toBeUndefined();
	});
});
