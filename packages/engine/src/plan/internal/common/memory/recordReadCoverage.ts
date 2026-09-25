import type { GapCheckLens } from '#src/contracts/plan/grade/GapCheckLens.ts';
import type { GradeDocsCoverage } from '#src/contracts/plan/memory/GradeDocsCoverage.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import type { GradeReadCoverage } from '#src/contracts/plan/memory/GradeReadCoverage.ts';

interface Params {
	/** The reader entries that still stand — `getStandingCoverage`'s `readers`. */
	standing: GradeReadCoverage[];
	/** The documentation entry that still stands, absent when it fell or was never written. */
	docs?: GradeDocsCoverage;
	/** Every (plan file, lens) pair a reader RETURNED for on this pass — `drainGradeAgents`' `read`. Per pair, not per file: a brief that returned keeps its entry even when a sibling lens failed on the same file. */
	read: Array<{ phase: string; lens: GapCheckLens }>;
	/** The plan files `weighSelection` weighed light, and the lenses a covered file must hold. A light file is read by nobody, so a full set of entries is written for it at its current design hash. */
	light: { phases: string[]; lenses: string[] };
	/** Each plan file's design hash now, keyed by basename. */
	designHashes: Map<string, string>;
	/** The phase graph as it stands now; absent when it could not be built, and then no reader entry is written. */
	connections?: Map<string, Set<string>>;
	/** Whether the whole-plan documentation checker finished on this pass. */
	documentationChecked: boolean;
	/** True when a human narrowed this pass with `--phase`: nothing is recorded. */
	narrowed: boolean;
	/** The pass timestamp every entry written here carries. */
	at: string;
}

/** One plan file and one brief, the pair an entry is written for. */
const keyOf = ({ file, lens }: { file: string; lens: string }) => `${file}\u0000${lens}`;

/**
 * Every (plan file, brief) pair this pass covers: the pairs a reader returned
 * for, and a full set for each file weighed light — no reader read a light file,
 * and the settled rule is that it is covered at its current text, re-derived
 * every pass. Once written the two are indistinguishable, so `getStandingCoverage`
 * needs no light-file rule of its own.
 */
const pairsRead = ({ read, light }: { read: Params['read']; light: Params['light'] }) => {
	const pairs = new Map<string, { file: string; lens: string }>();

	for (const { phase, lens } of read) {
		pairs.set(keyOf({ file: phase, lens }), { file: phase, lens });
	}

	for (const file of light.phases) {
		for (const lens of light.lenses) {
			pairs.set(keyOf({ file, lens }), { file, lens });
		}
	}

	return [...pairs.values()];
};

/**
 * This pass's own readings as entries, each at the plan file's current design
 * text and the graph neighbours it had when it was read.
 *
 * With no graph none is written at all: an entry recording no neighbours could
 * never be invalidated along a graph the next pass has lost, so it would claim a
 * reading that nothing can take back.
 */
const freshEntries = ({ read, light, designHashes, connections, at }: Pick<Params, 'read' | 'light' | 'designHashes' | 'connections' | 'at'>) => {
	if (connections === undefined) {
		return [];
	}

	return pairsRead({ read, light }).flatMap(({ file, lens }) => {
		const designSha256 = designHashes.get(file);

		return designSha256 === undefined ? [] : [{ file, lens, designSha256, neighbours: [...(connections.get(file) ?? [])].sort(), at }];
	});
};

/**
 * The documentation checker's own entry: every plan file this pass measured, at
 * the design text it measured, sorted by basename so the next pass's comparison
 * reads one settled order.
 */
const documentationEntry = ({ designHashes, at }: Pick<Params, 'designHashes' | 'at'>) => ({
	planFiles: [...designHashes].map(([file, designSha256]) => ({ file, designSha256 })).sort((left, right) => left.file.localeCompare(right.file)),
	at,
});

/**
 * Fold one pass's readings into the next coverage value.
 *
 * Pure and synchronous, and it writes no file: the caller folds the answer into
 * the memory beside the record merge, so every change to `grade-memory.json`
 * still goes through `writeGradeMemory` and its contract parse — the shape
 * `mergeFindingRecords` already has.
 *
 * A fresh entry replaces every standing entry for the same plan file and lens,
 * so a plan graded twice in one invocation holds one entry per pair rather than
 * two. A narrowed pass records nothing: a human's `--phase` must never buy an
 * approval. The documentation entry is rewritten only when the checker actually
 * ran, so it says what ran rather than what the pass reached.
 */
export const recordReadCoverage = ({
	standing,
	docs,
	read,
	light,
	designHashes,
	connections,
	documentationChecked,
	narrowed,
	at,
}: Params): GradeMemory['coverage'] => {
	if (narrowed) {
		return { readers: standing, docs };
	}

	const fresh = freshEntries({ read, light, designHashes, connections, at });
	const written = new Set(fresh.map((entry) => keyOf(entry)));

	return {
		readers: [...standing.filter((entry) => !written.has(keyOf(entry))), ...fresh],
		docs: documentationChecked ? documentationEntry({ designHashes, at }) : docs,
	};
};
