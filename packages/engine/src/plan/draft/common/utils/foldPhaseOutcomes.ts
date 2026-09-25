import type { PlanDraftReport } from '#src/contracts/plan/draft/PlanDraftReport.ts';
import { PlanDraftStatus } from '#src/contracts/plan/draft/PlanDraftStatus.ts';
import { PlanRunStatus } from '#src/plan/common/constants/PlanRunStatus.ts';
import { verifyDraftedFiles } from '#src/plan/common/paths/verifyDraftedFiles.ts';
import type { PhaseDeclaration } from '#src/plan/common/types/PhaseDeclaration.ts';
import { isRateLimited } from '#src/plan/common/utils/isRateLimited.ts';
import type { AuthorPhaseFilesResult } from '#src/plan/draft/common/types/AuthorPhaseFilesResult.ts';
import type { PhaseOutcome } from '#src/plan/draft/common/types/PhaseOutcome.ts';

interface Params {
	cwd: string;
	name: string;
	declarations: PhaseDeclaration[];
	results: Array<PhaseOutcome | undefined>;
}

/**
 * Fold every phase's outcome in one pass. Failures accumulate with the phase
 * file that produced them rather than short-circuiting, so one bad phase does
 * not hide the other nine, and a rate limit anywhere parks the whole draft —
 * it is resumable, and the phases that did land are overwritten by the re-run.
 *
 * Shared by both fan-outs: how a spawn's outcome becomes a draft status is the
 * same question whichever implementation opened the spawn, and a second copy of
 * the answer would drift the first time either gained a status.
 */
export const foldPhaseOutcomes = async ({ cwd, name, declarations, results }: Params): Promise<AuthorPhaseFilesResult> => {
	if (results.some((result) => isRateLimited({ result }))) {
		return { status: PlanRunStatus.PausedRateLimit, error: `rate limited or overloaded — re-run: lightsout plan draft --name ${name}` };
	}

	const discrepancies: string[] = [];
	const failures: string[] = [];
	const reports: PlanDraftReport[] = [];
	const filesWritten: { path: string }[] = [];

	for (const [index, result] of results.entries()) {
		const file = result?.declaration.file ?? declarations[index].file;

		if (result === undefined) {
			failures.push(`${file}: not authored`);
		} else if (!result.outcome.ok) {
			failures.push(`${file}: ${result.outcome.failure}`);
		} else if (result.outcome.report.status === PlanDraftStatus.Error) {
			discrepancies.push(...result.outcome.report.discrepancies.map((discrepancy) => `${file}: ${discrepancy}`));
		} else {
			reports.push(result.outcome.report);
			filesWritten.push(...result.outcome.report.filesWritten);
		}
	}

	if (discrepancies.length > 0) {
		return { status: PlanRunStatus.FactsError, discrepancies };
	}

	if (failures.length > 0) {
		return { status: PlanRunStatus.Failed, error: failures.join('; ') };
	}

	const drafted = await verifyDraftedFiles({ cwd, filesWritten });

	return 'error' in drafted
		? { status: PlanRunStatus.Failed, error: drafted.error }
		: { status: PlanRunStatus.Complete, planPaths: drafted.planPaths, reports };
};
