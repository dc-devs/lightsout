import { expect, test } from '@jest/globals';
import { DecisionSource } from '#src/contracts/plan/decisions/DecisionSource.ts';
import type { DecisionsRecord } from '#src/contracts/plan/decisions/DecisionsRecord.ts';
import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import { lintPlanStructure } from '#src/plan/lint/lintPlanStructure.ts';
import { cleanPlanBody } from '#tests/helpers/cleanPlanBody.ts';
import { emptyDecisionsRecord } from '#tests/helpers/emptyDecisionsRecord.ts';
import { planBodyWith } from '#tests/helpers/planBodyWith.ts';
import { setupConsumerRepo } from '#tests/helpers/setupConsumerRepo.ts';
import { writeDemoPlanFile } from '#tests/helpers/writeDemoPlanFile.ts';

// The per-file loop holds every plan file to the decision record the pass was
// handed: a section the engine composes has to be what that record renders,
// and a file whose section drifted is named along with the command that
// recomposes it.

/** The merged record a plan named `demo` was drafted from, carrying one settled row. */
const oneRowRecord = (): DecisionsRecord => ({
	planName: 'demo',
	decisions: [
		{
			source: DecisionSource.Elicitation,
			question: 'where does the complete decision history live?',
			options: 'the overview alone / a table in every phase file',
			choice: 'the overview alone',
			rationale: 'one table to keep in step with the record',
			assumption: false,
		},
	],
});

test('lintPlanStructure: a plan whose Decision Log disagrees with the record is reported against that file', async () => {
	const cwd = setupConsumerRepo();
	const path = writeDemoPlanFile({ cwd, name: 'stale-log.md', body: planBodyWith({ snippet: 'It replaces `src/ghost.ts`, which moved months ago.' }) });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: oneRowRecord() });
	const stale = findings.filter((finding) => finding.check === StructuralCheck.DecisionLogCurrent);

	// the body carries the section rendered from an empty record, so the one
	// settled row is missing from it, got: ${JSON.stringify(findings)}
	expect(stale.length).toBe(1);
	expect(stale[0]?.severity).toBe(FindingSeverity.Blocking);
	// the finding belongs to the file whose section is stale, and points at the
	// line the section starts on
	expect(stale[0]?.phase).toBe('stale-log.md');
	expect(stale[0]?.location ?? '').toMatch(/^stale-log\.md:\d+$/);
	// the remedy is the sync command, named for the plan the record belongs to
	expect(stale[0]?.fix ?? '').toContain('plan sync-decisions --name demo');
	// the file's other defect is still reported beside it — a stale log does not
	// swallow the rest of the lint
	expect(findings.some((finding) => finding.check === StructuralCheck.ProsePathExists)).toBeTruthy();
});

test("lintPlanStructure: the clean plan's rendered Decision Log passes the currency check", async () => {
	const cwd = setupConsumerRepo();
	const path = writeDemoPlanFile({ cwd, name: 'current-log.md', body: cleanPlanBody() });

	const findings = await lintPlanStructure({ cwd, planPaths: [path], decisions: emptyDecisionsRecord() });

	// the fixture's section is exactly what the renderer produces from an empty
	// record, so there is nothing to sync
	expect(findings.filter((finding) => finding.check === StructuralCheck.DecisionLogCurrent)).toStrictEqual([]);
	// and the plan is still clean everywhere else, got: ${JSON.stringify(findings)}
	expect(findings).toStrictEqual([]);
});
