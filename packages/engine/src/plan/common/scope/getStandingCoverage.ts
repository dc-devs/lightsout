import type { GradeDocsCoverage, GradeMemory, GradeReadCoverage } from '#src/contracts/index.ts';
import { getInvalidatedPhases } from '#src/plan/common/scope/getInvalidatedPhases.ts';

interface Params {
	/** The coverage the memory holds, as this pass found it. */
	coverage: GradeMemory['coverage'];
	/** Each plan file's design hash now, keyed by basename — the overview included, because the documentation entry covers it. */
	designHashes: Map<string, string>;
	/** The implementable plan files readers cover, by basename. The overview is never among them: no reader reads it alone. */
	phaseFiles: string[];
	/** Every lens a plan file must hold a standing entry for before it counts as covered — `gapCheckLenses`. */
	lenses: string[];
	/** The phase graph as it stands now; absent when it could not be built. */
	connections?: Map<string, Set<string>>;
	/** True when anything that is not plan text moved since the recorded pass — code, standards, config, prompts, model, effort. */
	otherInputChanged: boolean;
	/** Plan files the caller places as lost whatever their text says: the phases a changed decision row reaches, or every plan file when the overview's shared design moved or that reach cannot be placed. */
	seeds?: string[];
}

/** Each plan file's recorded neighbours, merged across its entries — one entry per brief, each recording the graph as it stood when that brief read the file. */
const recordedNeighbours = ({ readers }: { readers: GradeReadCoverage[] }) => {
	const recorded = new Map<string, string[]>();

	for (const entry of readers) {
		recorded.set(entry.file, [...new Set([...(recorded.get(entry.file) ?? []), ...entry.neighbours])]);
	}

	return recorded;
};

/**
 * The plan files whose coverage falls on their own account, before any closure
 * is walked: a file whose design text moved since it was read, a file no brief
 * has ever read, and the files the caller places.
 *
 * The seeds are assembled here rather than added to the answer afterwards, so a
 * seeded file's neighbours fall with it. A file holding SOME briefs' entries but
 * not every brief's is deliberately not among them: that is a brief added since
 * the last pass, which re-runs only itself, while a file nobody has read is a
 * phase whose hand-offs reach its neighbours.
 */
const lostOnTheirOwn = ({
	readers,
	designHashes,
	phaseFiles,
	seeds,
}: {
	readers: GradeReadCoverage[];
	designHashes: Map<string, string>;
	phaseFiles: string[];
	seeds: string[];
}) => {
	const moved = phaseFiles.filter((file) => readers.some((entry) => entry.file === file && entry.designSha256 !== designHashes.get(file)));
	const unread = phaseFiles.filter((file) => !readers.some((entry) => entry.file === file));

	return [...new Set([...seeds, ...moved, ...unread])];
};

/**
 * The documentation checker's entry when it still speaks for the plan in front
 * of it: the same plan files, each at the design text the entry recorded.
 *
 * Any difference — a file rewritten, a file added by a repair, a file removed —
 * drops it, because the checker reads every plan file at once and a check that
 * never saw one of them may never grant an approval covering it.
 */
const standingDocs = ({ docs, designHashes }: { docs?: GradeDocsCoverage; designHashes: Map<string, string> }) => {
	const recorded = docs?.planFiles ?? [];
	const stands = docs !== undefined && recorded.length === designHashes.size && recorded.every((entry) => designHashes.get(entry.file) === entry.designSha256);

	return stands ? docs : undefined;
};

/**
 * What of the recorded coverage still speaks for the plan as it is now — the
 * readings a pass may keep, the plan files they cover, and the plan files this
 * pass owes a reading.
 *
 * `otherInputChanged` is answered first and alone: a reading taken under
 * different prompts, standards, configuration or model is no reading of this
 * plan, so no entry stands and the design hashes are never consulted.
 */
export const getStandingCoverage = ({
	coverage,
	designHashes,
	phaseFiles,
	lenses,
	connections,
	otherInputChanged,
	seeds = [],
}: Params): {
	/** The reader entries that still stand, in record order. */
	readers: GradeReadCoverage[];
	/** The plan files holding a standing entry for every lens — covered at their current text. */
	covered: string[];
	/** The plan files whose coverage fell, so this pass owes them a reading. */
	invalidated: string[];
	/** The documentation entry when it still stands; absent when it fell or was never written. */
	docs?: GradeDocsCoverage;
} => {
	if (otherInputChanged) {
		return { readers: [], covered: [], invalidated: [...phaseFiles].sort() };
	}

	const edited = lostOnTheirOwn({ readers: coverage.readers, designHashes, phaseFiles, seeds });
	const lost = getInvalidatedPhases({ edited, connections, recorded: recordedNeighbours({ readers: coverage.readers }), phaseFiles });
	const readers = coverage.readers.filter((entry) => !lost.includes(entry.file) && entry.designSha256 === designHashes.get(entry.file));
	const covers = ({ file, lens }: { file: string; lens: string }) => readers.some((entry) => entry.file === file && entry.lens === lens);
	const covered = phaseFiles.filter((file) => lenses.every((lens) => covers({ file, lens }))).sort();
	const docs = standingDocs({ docs: coverage.docs, designHashes });

	return {
		readers,
		covered,
		invalidated: phaseFiles.filter((file) => !covered.includes(file)).sort(),
		...(docs === undefined ? {} : { docs }),
	};
};
