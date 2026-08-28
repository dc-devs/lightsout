import { createdFileCeiling } from '#src/common/constants/createdFileCeiling.ts';
import { FindingSeverity, StructuralCheck, type StructuralFinding } from '#src/contracts/index.ts';
import type { PhaseFile } from '#src/plan/common/types/PhaseFile.ts';
import type { PhaseSizeCounts } from '#src/plan/common/types/PhaseSizeCounts.ts';

interface Params {
	phase: PhaseFile;
	/** The configured executor-file-limit — the default budget a plan may declare its own replacement for. */
	fileLimit: number;
	counts: PhaseSizeCounts;
}

/**
 * The two size numbers. The created-file count is a real ceiling and is never
 * declarable; the touched count is advisory and measured against whatever this
 * plan declares for itself, because a phase that creates three files and renames
 * an import across two hundred is legitimate work one repo-wide number cannot
 * express.
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
