import { expect, test } from '@jest/globals';
import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import { renderDecisionLog } from '#src/plan/decisionLog/renderDecisionLog.ts';
import { lintPlanStructure } from '#src/plan/lint/lintPlanStructure.ts';
import { renderGlobalConstraints } from '#src/plan/sections/renderGlobalConstraints.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeDemoPlanFile } from '#tests/helpers/writeDemoPlanFile.ts';

/**
 * A single implementable plan whose two contested spans the caller chooses: the
 * `## Global Constraints` section verbatim, and the body of
 * `## What Next Plan Expects`. Everything else is the clean plan's content, so
 * the only findings either test can see are the ones it arranged.
 */
const handoffPlan = ({ constraints, handsForward }: { constraints: string; handsForward: string }) => `# Clean Plan

## Context

A tiny clean plan for the structural lint.

${renderDecisionLog({ decisions: [] })}

${constraints}

## Prerequisites

- None

## Files to Create

### \`src/new-thing.ts\`

A new module exporting \`newThing\`.

## Files to Modify

### \`src/index.js\`

Re-export \`newThing\`.

## Patterns to Mirror

- \`src/index.js\` — mirror its single-export shape.

## Prior Art

- \`newThing\` — searched newThing/new-thing, found none (new).

## Scope Boundaries

**Do:**
- Add \`newThing\`.

**Do NOT:**
- Touch anything else.

## Verification

- \`true\` — types clean

## What Next Plan Expects

${handsForward}
`;

test('lintPlanStructure: a stale Global Constraints section and an unnamed hand-off each block', async () => {
	const cwd = setupConsumerRepo();
	const body = handoffPlan({
		// the note line the renderer writes, with a rule underneath it that no
		// decision record holds — a hand edit to a section the engine composes
		constraints: `## Global Constraints\n\nComposed from this plan's saved decision records — every \`Global constraint:\` row. Do not edit by hand.\n\n- Never ship on a Friday.`,
		handsForward: 'The next plan continues from where this one stops.',
	});
	const path = writeDemoPlanFile({ cwd, name: 'both-stale.md', body });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });
	const constraints = findings.filter((finding) => finding.check === StructuralCheck.GlobalConstraintsCurrent);
	const handoff = findings.filter((finding) => finding.check === StructuralCheck.HandoffDeclared);

	// both checks hang in the per-file loop, so one pass over one file reports
	// both defects against that file, got: ${JSON.stringify(findings)}
	expect(constraints).toEqual([expect.objectContaining({ severity: FindingSeverity.Blocking, phase: 'both-stale.md' })]);
	expect(handoff).toEqual([expect.objectContaining({ severity: FindingSeverity.Blocking, phase: 'both-stale.md' })]);
});

test('lintPlanStructure: a single plan with an unnamed hand-off is checked, having no phase boundary to be checked across', async () => {
	const cwd = setupConsumerRepo();
	const body = handoffPlan({
		constraints: renderGlobalConstraints({ decisions: [] }),
		handsForward: 'Whoever picks this up next will know what to do.',
	});
	const path = writeDemoPlanFile({ cwd, name: 'plan.md', body });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });
	const handoff = findings.filter((finding) => finding.check === StructuralCheck.HandoffDeclared);

	// the pairwise hand-off check compares one phase against the next and so
	// returns nothing at all for a deliverable of one file; this check reads the
	// file on its own, got: ${JSON.stringify(findings)}
	expect(handoff).toEqual([expect.objectContaining({ severity: FindingSeverity.Blocking, phase: 'plan.md' })]);
});
