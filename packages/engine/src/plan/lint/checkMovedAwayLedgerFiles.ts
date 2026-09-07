import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import type { ParsedPlan } from '#src/plan/common/types/ParsedPlan.ts';

interface Params {
	plan: ParsedPlan;
	/** The finding label: the plan file's basename. */
	phase: string;
}

/**
 * LedgerWellFormed — a ledger row may not name a test file this plan moves away.
 *
 * A row names the test that proves a criterion, and the source side of a
 * `## Files to Move` heading is not there to hold it: the plan takes that file
 * away, so the row is pointed at nothing by the time the gates run.
 *
 * A file the plan merely MODIFIES is no longer a finding. Editing a test file
 * the plan's own changes make stale is ordinary work now that a reviewer judges
 * the exact change against the plan before any gate runs, so a row naming it
 * asks for nothing contradictory. A move's DESTINATION is not a finding either:
 * it is where the test lives once the plan has run.
 */
export const checkMovedAwayLedgerFiles = ({ plan, phase }: Params): StructuralFinding[] => {
	const findings: StructuralFinding[] = [];
	const movedAway = new Set(plan.movePaths.map((move) => move.from));

	// One finding per file rather than per row: a ledger naming the same vanished
	// file twelve times is one mistake, and twelve copies of the same sentence
	// bury the other findings beside them.
	const reported = new Set<string>();

	for (const row of plan.ledger) {
		if (movedAway.has(row.testFile) && !reported.has(row.testFile)) {
			reported.add(row.testFile);
			findings.push({
				check: StructuralCheck.LedgerWellFormed,
				severity: FindingSeverity.Blocking,
				phase,
				issue: `ledger row names '${row.testFile}', which this plan moves away under \`## Files to Move\` — that file does not exist when the tests run`,
				location: `${phase}:${row.line}`,
				fix: 'point the row at the move’s destination, where the test lives after the plan runs, or drop the move',
			});
		}
	}

	return findings;
};
