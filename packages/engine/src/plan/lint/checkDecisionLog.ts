import { type DecisionsRecord, FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import { PlanFileKind } from '#src/plan/common/constants/PlanFileKind.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';
import { decisionLogReference, renderDecisionLog } from '#src/plan/decisionLog/index.ts';

interface Params {
	/** The parsed plan file — read for its `decisionLogRange`, its `lines` and its variant. */
	plan: ParsedPlan;
	/** The finding label: this file's basename. */
	phase: string;
	/** The merged decision record, brainstorm rows first. */
	decisions: DecisionsRecord;
	/** Whether the deliverable this file belongs to is phased — an overview is present, or more than one implementable file is. */
	phased: boolean;
	/** The command a human runs to fix a finding — `buildPlanSyncDecisionsCommand(...).command`. */
	syncCommand: string;
}

/**
 * The section this file is expected to carry. Decided here rather than by each
 * caller, so the deterministic lint and the dedup precheck cannot ask one plan
 * file for two different sections: a phase file of a phased deliverable carries
 * the pointer at the overview's log, and everything else — a single `plan.md`,
 * a phased deliverable's `overview.md` — carries the full table.
 */
const expectedSection = ({ plan, decisions, phased }: { plan: ParsedPlan; decisions: DecisionsRecord; phased: boolean }) =>
	phased && plan.variant === PlanFileKind.Implementable ? decisionLogReference() : renderDecisionLog({ decisions: decisions.decisions });

/**
 * One section's lines as they compare: each line's trailing whitespace removed
 * and trailing blank lines dropped. How a section joins the heading below it is
 * the rewriter's business, so a file that differs from the rendered text only in
 * how it ends is current rather than stale.
 */
const comparable = ({ lines }: { lines: string[] }) => {
	const trimmed = lines.map((line) => line.replace(/\s+$/, ''));

	while (trimmed.at(-1) === '') {
		trimmed.pop();
	}

	return trimmed.join('\n');
};

/**
 * DecisionLogCurrent — a plan file whose `## Decision Log` is not the section
 * the engine would compose from the saved decision records, or which has no
 * such section at all.
 *
 * It blocks: the record is the one authoritative decision history, and a
 * displayed table that disagrees with it is a plan whose reader is told
 * something nobody settled. The remedy is never a hand edit, so the `fix` names
 * the sync command rather than describing what to type — the section belongs to
 * `plan sync-decisions` and to nothing else.
 *
 * Pure and synchronous, like the renderer it compares against: every read-only
 * pass reaches this check, and a check that read the disk a second time could
 * report a difference between two reads rather than a difference the plan has.
 */
export const checkDecisionLog = ({ plan, phase, decisions, phased, syncCommand }: Params): StructuralFinding[] => {
	const range = plan.decisionLogRange;
	const shared = { check: StructuralCheck.DecisionLogCurrent, severity: FindingSeverity.Blocking, phase } as const;
	const fix = `run \`${syncCommand}\` — the Decision Log is composed from the saved decision records and never edited by hand`;

	if (range === undefined) {
		return [{ ...shared, issue: "no '## Decision Log' section — the engine composes one for every plan file", location: phase, fix }];
	}

	const carried = comparable({ lines: plan.lines.slice(range.start - 1, range.end) });
	const expected = comparable({ lines: expectedSection({ plan, decisions, phased }).split('\n') });

	return carried === expected
		? []
		: [{ ...shared, issue: 'the Decision Log disagrees with the saved decision records', location: `${phase}:${range.start}`, fix }];
};
