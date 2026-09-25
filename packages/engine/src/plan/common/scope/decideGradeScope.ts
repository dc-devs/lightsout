import { basename } from 'node:path';
import type { GradeInputs } from '#src/contracts/plan/memory/GradeInputs.ts';
import type { GradeMemory } from '#src/contracts/plan/memory/GradeMemory.ts';
import { GradeScope } from '#src/contracts/plan/memory/GradeScope.ts';
import { gapCheckLenses } from '#src/plan/common/constants/gapCheckLenses.ts';
import { getCoverageSeeds } from '#src/plan/common/scope/getCoverageSeeds.ts';
import { getDesignHashes } from '#src/plan/common/scope/getDesignHashes.ts';
import { getEditedPhases } from '#src/plan/common/scope/getEditedPhases.ts';
import { getPhaseGraph } from '#src/plan/common/scope/getPhaseGraph.ts';
import { getStandingCoverage } from '#src/plan/common/scope/getStandingCoverage.ts';
import type { DeliverableFile } from '#src/plan/common/types/DeliverableFile.ts';
import type { GradeScopeDecision } from '#src/plan/common/types/GradeScopeDecision.ts';

interface Params {
	/** Every implementable plan file with its text, in deliverable order. */
	files: DeliverableFile[];
	/** Overview text for a phased plan; absent for a single plan. */
	overviewText?: string;
	/** The memory as it was read at the start of this pass; absent when the file is not there. */
	memory?: GradeMemory;
	/** This pass's fingerprint. */
	inputs: GradeInputs;
	/** True when a human passed `--phase` — a narrowed pass is never reused and never focused. */
	narrowed: boolean;
}

/** Every plan file the readers would be offered by a full pass. */
const everyPhase = ({ files }: { files: DeliverableFile[] }) => files.map((file) => basename(file.path));

/**
 * How far this pass must reach, decided by the engine from the plan, the memory,
 * the fingerprint and what the readers have already read — there is no flag,
 * because a human cannot know which phases a repair can reach.
 *
 * The rules fire in order and every one of them falls back to a full review,
 * because the global constraint is that a cheaper pass must never turn an
 * unresolved blocker into an approval:
 *
 * 1. A `--phase` narrowing is a human's own choice and replaces nothing.
 * 2. An unread git probe is not evidence the code is unchanged, so it can
 *    neither be reused against nor narrowed against.
 * 3. A recorded passing full review over these very inputs is reported as
 *    current rather than paid for twice.
 * 4. With no memory, or no pass recorded in it, there is no baseline to compare
 *    the plan text against.
 * 5. A non-plan-text input moving means the recorded reading no longer speaks
 *    for this pass at all. A change to the overview's SHARED design text — what
 *    is left once every generated region and every span credited to one phase is
 *    taken out — is context every phase shares; a Decision Log change reaches the
 *    phases its changed rows name; and a change whose reach cannot be placed is a
 *    full review.
 * 6. A single plan has no phase to narrow to.
 * 7. A graph that cannot be built cannot bound anything.
 * 8. What is left is the plan files whose coverage does not stand: the ones this
 *    pass owes a reading. A set covering every file is a full pass by another
 *    name.
 *
 * Nothing here decides whether the plan is approved. That is read from the
 * coverage and the closed findings afterwards, which is why a pass whose
 * coverage already stands everywhere may read nothing at all and still be the
 * pass that grants an A.
 */
export const decideGradeScope = ({ files, overviewText, memory, inputs, narrowed }: Params): GradeScopeDecision => {
	const phases = everyPhase({ files });
	const full = ({ reason }: { reason: string }): GradeScopeDecision => ({ scope: GradeScope.Full, phases, reuse: false, reason });

	if (narrowed) {
		return full({ reason: 'full review: a human narrowed this pass with --phase, which the engine never overrides' });
	}

	if (inputs.gradedCommit === undefined || inputs.changedFiles === undefined) {
		return full({ reason: 'full review: the git probe did not run, so the state of the code beside the plan is unknown' });
	}

	if (memory?.lastPassingFullReview?.inputs.sha256 === inputs.sha256) {
		return { scope: GradeScope.Full, phases, reuse: true, reason: 'the recorded passing full review already covers these inputs' };
	}

	const previous = memory?.lastPass?.inputs;

	if (previous === undefined) {
		return full({ reason: 'full review: no earlier pass is on record, so this pass is the baseline' });
	}

	const { otherInputChanged } = getEditedPhases({ current: inputs, previous });

	if (otherInputChanged) {
		return full({ reason: 'full review: the code, standards, configuration, prompts or model moved since the last pass' });
	}

	const seeded = getCoverageSeeds({ inputs, previous, overviewText, phaseFiles: phases });

	if ('error' in seeded) {
		return full({ reason: `full review: ${seeded.error}` });
	}

	if (files.length < 2 || overviewText === undefined) {
		return full({ reason: 'full review: a single plan file has no phase closure to narrow to' });
	}

	const graph = getPhaseGraph({ files, overviewText });

	if ('error' in graph) {
		return full({ reason: `full review: the phase graph could not be built — ${graph.error}` });
	}

	const standing = getStandingCoverage({
		coverage: memory?.coverage ?? { readers: [] },
		designHashes: getDesignHashes({ inputs }),
		phaseFiles: phases,
		lenses: gapCheckLenses,
		connections: graph.connections,
		otherInputChanged: false,
		seeds: seeded.seeds,
	});

	if (standing.invalidated.length >= files.length) {
		return full({ reason: 'full review: no recorded reading still stands, so this pass reads every plan file anyway' });
	}

	const reach = standing.invalidated.length > 0 ? standing.invalidated.join(', ') : 'nothing — every plan file is covered at its current text';
	const reason = `focused review: the plan files whose recorded reading no longer stands — ${reach}`;

	return { scope: GradeScope.Focused, phases: standing.invalidated, reuse: false, reason };
};
