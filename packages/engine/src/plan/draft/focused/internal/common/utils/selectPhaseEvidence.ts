import type { SourceEvidenceIndex } from '#src/contracts/plan/evidence/SourceEvidenceIndex.ts';
import type { ExploreArea } from '#src/contracts/plan/facts/ExploreArea.ts';
import type { PlanFacts } from '#src/contracts/plan/facts/PlanFacts.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';

interface Params {
	evidence: SourceEvidenceIndex;
	facts: PlanFacts;
	declaration: PhaseDeclaration;
}

/** An integration point's `at` reduced to its path half — the text before a trailing `:line` or `:line:column`. */
const atPath = ({ at }: { at: string }) => at.replace(/:\d+(?::\d+)?$/, '');

/**
 * The neighbourhood one path belongs to: its package directory, its source root,
 * and the first folder inside that root.
 *
 * Cut one folder below the source root rather than at the containing directory,
 * because a phase creating `.../draft/focused/authorFocusedPhaseFiles.ts` is
 * plainly working on the same surface as a file recorded at
 * `.../draft/repairPlanStructure.ts`, and an exact-directory comparison would
 * call them unrelated. A path with no source root is taken whole, which is the
 * conservative answer for a repository laid out some other way.
 */
const neighbourhood = ({ path }: { path: string }) => {
	const segments = path.split('/').slice(0, -1);
	const sourceRoot = segments.indexOf('src');

	return (sourceRoot === -1 ? segments : segments.slice(0, sourceRoot + 2)).join('/');
};

/** Every path one explorer area recorded, whatever kind of location recorded it. */
const areaPaths = ({ area }: { area: ExploreArea }) => [
	...area.filesToModify.map(({ path }) => path),
	...area.patternsToMirror.map(({ path }) => path),
	...area.integrationPoints.map(({ at }) => atPath({ at })),
];

/**
 * Narrow a draft's collected evidence to what one phase's writer needs.
 *
 * An area is relevant to a phase when any path it recorded shares a
 * neighbourhood with any path the phase's declaration creates, and a relevant
 * area contributes all of its evidence. Every `patternsToMirror` path is
 * contributed whatever the phase: a reference pattern is what the writer is being
 * asked to imitate, rather than something its own paths point at.
 *
 * A declaration that creates nothing has nothing to narrow by and receives the
 * whole index. That is the honest degradation rather than a bug — code cannot
 * discover architectural relevance, so where the declaration supplies no signal
 * the writer gets everything the engine read.
 */
export const selectPhaseEvidence = ({ evidence, facts, declaration }: Params): SourceEvidenceIndex => {
	if (declaration.creates.length === 0) {
		return evidence;
	}

	const created = new Set(declaration.creates.map((path) => neighbourhood({ path })));
	const wanted = new Set<string>();

	for (const area of facts.areas) {
		const paths = areaPaths({ area });

		for (const path of paths.some((path) => created.has(neighbourhood({ path }))) ? paths : area.patternsToMirror.map(({ path }) => path)) {
			wanted.add(path);
		}
	}

	return { ...evidence, entries: evidence.entries.filter((entry) => wanted.has(entry.path)) };
};
