import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import { getComparableTokens } from '#src/plan/internal/common/naming/getComparableTokens.ts';

interface Params {
	/** Implementable plan files, ordered by phase number. */
	phases: PhaseFile[];
}

/**
 * HandoffChained — each phase's `## What Next Plan Expects` must be claimed by
 * the next phase's `## Prerequisites`.
 *
 * Both sides are reduced by `getComparableTokens`, which decides what counts as
 * a name: a path span by its basename, a bare identifier verbatim, the
 * template's sentinel absences skipped and every other span and all prose
 * ignored. That makes this check exactly decidable rather than a sentence diff,
 * and it is spelled there rather than here because the phase graph is built from
 * the same reduction.
 *
 * Names are all this check owns. What a hand-off *carries* — the shape behind
 * the name — is declared once, in the defining phase's file entry, and compared
 * by the wiring gap-check reader, which can open both phases.
 *
 * The two token sets are compared as sets, and the receiving side is never
 * searched as raw text, which would let an identifier match inside a longer word
 * and would count a path mentioned in unrelated prose as a claim. A missing section on either side is already a
 * `sections-present` finding, so the pair is skipped rather than reported twice.
 *
 * Blocking, not advisory: the point of the check is that a mechanical hand-off
 * break never survives to the agent grade. The repair loop is capped at three
 * attempts, so a stubborn false positive surfaces to the human rather than
 * wedging a draft.
 *
 * The final phase is not checked forward: it has no successor, and the template
 * already has it state "None — final phase."
 */
export const checkPhaseHandoffs = ({ phases }: Params): StructuralFinding[] => {
	const findings: StructuralFinding[] = [];

	for (const [index, phase] of phases.slice(0, -1).entries()) {
		const next = phases[index + 1];
		const handedForward = phase.plan.sections.get('What Next Plan Expects');
		const claimed = next.plan.sections.get('Prerequisites');

		if (handedForward === undefined || claimed === undefined) {
			continue;
		}

		const claimedTokens = getComparableTokens({ lines: claimed });

		for (const [token, spelling] of getComparableTokens({ lines: handedForward })) {
			if (claimedTokens.has(token)) {
				continue;
			}

			findings.push({
				check: StructuralCheck.HandoffChained,
				severity: FindingSeverity.Blocking,
				phase: next.base,
				issue: `${phase.base} hands forward \`${spelling}\`, which this phase's Prerequisites never claim`,
				location: `${next.base} → Prerequisites`,
				fix: `name \`${spelling}\` in '## Prerequisites', or drop it from ${phase.base}'s '## What Next Plan Expects'`,
			});
		}
	}

	return findings;
};
