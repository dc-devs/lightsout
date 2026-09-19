import { type DecisionsRecord, FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { generatedPlanRegions } from '#src/plan/common/constants/generatedPlanRegions.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { getComparableSection } from '#src/plan/lint/common/utils/getComparableSection.ts';
import { renderGlobalConstraints } from '#src/plan/sections/index.ts';

interface Params {
	/** The parsed plan file — read for its `generatedRegionRanges` and its `lines`. */
	plan: ParsedPlan;
	/** The finding label: this file's basename. */
	phase: string;
	/** The merged decision record, brainstorm rows first. */
	decisions: DecisionsRecord;
	/** The command a human runs to fix a finding — `buildPlanSyncDecisionsCommand(...).command`. */
	syncCommand: string;
}

/**
 * GlobalConstraintsCurrent — a plan file whose `## Global Constraints` is not
 * the section the engine would compose from the saved decision records, or which
 * has no such section at all.
 *
 * It blocks for the reason its Decision Log sibling does: the rules binding a
 * plan are composed from the record, and displayed rules that disagree with it
 * bind an implementing agent to something nobody settled. The remedy is never a
 * hand edit, so the `fix` names the sync command rather than describing what to
 * type.
 *
 * Unlike `checkDecisionLog` it takes no `phased` flag, and the difference is
 * load-bearing: `syncGlobalConstraints` writes the same rendered section into
 * every file of a deliverable — a phase file is handed to an implementing agent
 * on its own, so it carries the rules rather than a pointer to them — so every
 * plan file of every variant is compared against one re-render.
 *
 * Pure and synchronous, like the renderer it compares against: every read-only
 * pass reaches this check, and a check that read the disk a second time could
 * report a difference between two reads rather than a difference the plan has.
 */
export const checkGlobalConstraints = ({ plan, phase, decisions, syncCommand }: Params): StructuralFinding[] => {
	const range = plan.generatedRegionRanges.get(generatedPlanRegions.globalConstraints);
	const shared = { check: StructuralCheck.GlobalConstraintsCurrent, severity: FindingSeverity.Blocking, phase } as const;
	const fix = `run \`${syncCommand}\` — the Global Constraints are composed from the saved decision records and never edited by hand`;

	if (range === undefined) {
		return [{ ...shared, issue: "no '## Global Constraints' section — the engine composes one for every plan file", location: phase, fix }];
	}

	const carried = getComparableSection({ lines: plan.lines.slice(range.start - 1, range.end) });
	const expected = getComparableSection({ lines: renderGlobalConstraints({ decisions: decisions.decisions }).split('\n') });

	return carried === expected
		? []
		: [{ ...shared, issue: 'the Global Constraints disagree with the saved decision records', location: `${phase}:${range.start}`, fix }];
};
