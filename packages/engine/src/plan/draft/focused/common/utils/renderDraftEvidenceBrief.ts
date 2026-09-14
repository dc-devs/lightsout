import type { SourceEvidenceIndex } from '#src/contracts/index.ts';
import { renderEvidenceBrief } from '#src/plan/evidence/index.ts';

interface Params {
	/** The draft's collected evidence. Absent only when the context carries none — a legacy context, or a focused one wired without a collection. */
	evidence: SourceEvidenceIndex | undefined;
}

/**
 * The whole draft's evidence as one writer's brief — every entry the engine
 * collected, in the order it stored them.
 *
 * Both focused flows open with a single spawn that is authoring the plan or the
 * overview, and neither has a declaration to narrow by yet, so both hand over
 * everything. Spelled once because two copies of "render all of it" is one edit
 * away from the single flow and the overview spawn being briefed differently for
 * no stated reason.
 *
 * @returns the rendered section, or the empty string when there is no evidence to render
 */
export const renderDraftEvidenceBrief = ({ evidence }: Params): string =>
	evidence === undefined ? '' : renderEvidenceBrief({ index: evidence, paths: evidence.entries.map((entry) => entry.path) });
