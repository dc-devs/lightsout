import type { CoverageWorklist, PipelineKind, RefactorWorklist } from '#src/contracts/index.ts';

/** A refactor run's frozen work-list, when the file parsed as one. */
interface FrozenRefactorWorklist {
	kind: typeof PipelineKind.Refactor;
	worklist?: RefactorWorklist;
}

/** A coverage run's frozen initial measurement, when the file parsed as one. */
interface FrozenCoverageWorklist {
	kind: typeof PipelineKind.Coverage;
	worklist?: CoverageWorklist;
}

/**
 * A run's frozen work-list, tagged by which pipeline froze it — the two share a
 * path and a filename on disk, so the tag is the only thing that tells them
 * apart. Refactor and coverage are the only two pipelines that freeze one, which
 * is why this union names two of the four pipeline kinds.
 *
 * The payload is optional on purpose: the kind is taken from the manifest's
 * pipeline before the file is read, so a coverage run whose work-list is corrupt
 * is still known to be a coverage run rather than silently read as a refactor.
 */
export type FrozenWorklist = FrozenRefactorWorklist | FrozenCoverageWorklist;
