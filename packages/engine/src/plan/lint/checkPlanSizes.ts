import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { touchedFileCeiling } from '#src/common/constants/touchedFileCeiling.ts';
import { FindingSeverity } from '#src/contracts/plan/grade/FindingSeverity.ts';
import { StructuralCheck } from '#src/contracts/plan/grade/StructuralCheck.ts';
import type { StructuralFinding } from '#src/contracts/plan/grade/StructuralFinding.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseSizeCounts } from '#src/plan/common/types/PhaseSizeCounts.ts';

interface Params {
	phase: PhaseFile;
	/** The configured executor-file-limit — the default budget a plan may declare its own replacement for. */
	fileLimit: number;
	counts: PhaseSizeCounts;
}

/**
 * The three size numbers: two fixed ceilings and one advisory budget. The
 * created-file count and the touched count each have a real ceiling that no
 * declaration raises. The touched count is also measured against whatever
 * budget this plan declares for itself, as an advisory note that reads beside
 * the ceiling rather than in place of it.
 *
 * A rename-only plan (one with a `## Renames` section) is exempt from the
 * touched ceiling, because a repo-wide rename's size is not what makes it hard.
 */
export const checkPlanSizes = ({ phase, fileLimit, counts }: Params): StructuralFinding[] => {
	const findings: StructuralFinding[] = [];
	const { created, touched } = counts;
	const budget = phase.plan.fileBudget ?? fileLimit;

	if (created > createdFileCeiling) {
		findings.push({
			check: StructuralCheck.CreatedFilesWithinCeiling,
			severity: FindingSeverity.Blocking,
			phase: phase.base,
			issue: `plan creates ${created} source files, over the ${createdFileCeiling}-file ceiling`,
			location: phase.base,
			fix: `split the phase so it creates no more than ${createdFileCeiling} files`,
		});
	}

	if (touched > touchedFileCeiling && phase.plan.renames.length === 0) {
		findings.push({
			check: StructuralCheck.TouchedFilesWithinCeiling,
			severity: FindingSeverity.Blocking,
			phase: phase.base,
			issue: `plan touches ${touched} source files, over the ${touchedFileCeiling}-file ceiling`,
			location: phase.base,
			fix: `split the phase so it touches no more than ${touchedFileCeiling} files — or, if its whole work is renaming, declare it rename-only with a '## Renames' section`,
		});
	}

	if (touched > budget) {
		const source = phase.plan.fileBudget === undefined ? 'the configured executor-file-limit' : "this plan's own ## File Budget";

		findings.push({
			check: StructuralCheck.ScopeWithinGuardrail,
			severity: FindingSeverity.Advisory,
			phase: phase.base,
			issue: `plan touches ${touched} source files, over the ${budget}-file limit from ${source}`,
			location: phase.base,
			fix: `legal, but the implementing agent stops at ${budget} files — a mostly-mechanical phase should declare a '## File Budget' covering its real touched count`,
		});
	}

	return findings;
};
