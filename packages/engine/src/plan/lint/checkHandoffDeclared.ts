import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import { PlanFileKind } from '#src/plan/internal/common/constants/PlanFileKind.ts';
import { planSentinelTokens } from '#src/plan/internal/common/constants/planSentinelTokens.ts';
import { getComparableTokens } from '#src/plan/internal/common/naming/getComparableTokens.ts';
import type { ParsedPlan } from '#src/plan/internal/common/types/ParsedPlan.ts';

interface Params {
	/** The parsed plan file — read for its variant and its `## What Next Plan Expects` section. */
	plan: ParsedPlan;
	/** The finding label: this file's basename. */
	phase: string;
}

/**
 * Whether one line states that the file hands nothing forward: its leading run
 * of letters, taken after a `-` or `*` bullet marker and the surrounding
 * whitespace, is one of the template's sentinel words.
 *
 * Text-level rather than a backticked span, because the template's own
 * final-phase spelling is a bare sentence — `None — final phase.` — and both it
 * and the standalone form carry prose after the sentinel word.
 */
const declaresAbsence = ({ line }: { line: string }) => {
	const word = /^[A-Za-z]+/.exec(line.trim().replace(/^[-*]\s*/, ''))?.[0];

	return word !== undefined && planSentinelTokens.has(word);
};

/**
 * HandoffDeclared — an implementable plan file whose `## What Next Plan Expects`
 * names nothing a later phase could claim and does not say it hands nothing
 * forward.
 *
 * Blocking, for the reason `checkPhaseHandoffs` is: the phase graph a narrowed
 * re-grade reaches along is built from these tokens, so a hand-off written as
 * prose supplies no edge and is a silent gap in that graph rather than a
 * stylistic lapse. `checkPhaseHandoffs` cannot close it — it compares one
 * phase's hand-off against the next phase's claim, and a side yielding no token
 * passes it silently.
 *
 * Two files it says nothing about, each because another check owns the defect:
 * an overview, whose hand-offs live in `## Phase Declarations` and belong to
 * `checkPhaseDeclarations`; and a file carrying no `## What Next Plan Expects`
 * at all, which is a `sections-present` finding already.
 *
 * Per-file rather than cross-phase, because `lintPlanCrossPhase` returns nothing
 * at all for a deliverable of one file, which would leave a single `plan.md`
 * unchecked.
 */
export const checkHandoffDeclared = ({ plan, phase }: Params): StructuralFinding[] => {
	const handedForward = plan.sections.get('What Next Plan Expects');

	if (plan.variant !== PlanFileKind.Implementable || handedForward === undefined) {
		return [];
	}

	const declared = getComparableTokens({ lines: handedForward }).size > 0 || handedForward.some((line) => declaresAbsence({ line }));

	return declared
		? []
		: [
				{
					check: StructuralCheck.HandoffDeclared,
					severity: FindingSeverity.Blocking,
					phase,
					issue: "'## What Next Plan Expects' names nothing a later plan could claim and states no absence",
					location: `${phase} → What Next Plan Expects`,
					fix: 'name what this plan hands forward in a backticked span — a path or a bare identifier — or write `None` to say it hands nothing forward',
				},
			];
};
