import type { RefactorWorklist } from '#src/contracts/index.ts';
import { RunStatus, StandardsSeverity } from '#src/contracts/index.ts';
import { countByRule } from '#src/refactor/countByRule.ts';
import { describeIntroducedFindings } from '#src/refactor/describeIntroducedFindings.ts';
import { findIntroducedFindings } from '#src/refactor/findIntroducedFindings.ts';
import type { RefactorResult } from '#src/refactor/RefactorResult.ts';
import type { RefactorRun } from '#src/refactor/RefactorRun.ts';
import { runStandardsCheck } from '#src/standardsCheck/index.ts';

interface Params {
	run: RefactorRun;
	/** The frozen work-list — its scope drives the re-check, its findings are what the run owed. */
	worklist: RefactorWorklist;
}

/**
 * The run's closing whole-scope re-check, and the verdict it earns.
 *
 * Two different things can be blocking when the batches are done. A work-list
 * finding still standing is a decline — a human's call, reported and not
 * failed. A blocking finding that was never on the work-list is the run's own
 * doing, and certifying that as a pass would make the gate worthless.
 */
export const closeRefactorRun = async ({ run, worklist }: Params): Promise<RefactorResult> => {
	const finalCheck = await runStandardsCheck({ cwd: run.cwd, path: worklist.path === '.' ? undefined : worklist.path, all: worklist.all, persist: false });
	// Finding severity only, mirroring the worklist filter — the burn-down
	// compares work against work, never advisories.
	const after = countByRule({ findings: finalCheck.findings.filter((finding) => finding.severity === StandardsSeverity.Blocking) });
	const introduced = findIntroducedFindings({
		frozen: worklist.batches.flatMap((batch) => batch.blocking),
		live: finalCheck.findings,
		severity: StandardsSeverity.Blocking,
	});

	// It rides out carrying the real `after` rather than the halted default:
	// the burn-down table is the evidence for what just happened, and this is
	// the run where the reader most needs to read it.
	if (introduced.length > 0) {
		const stopped = await run.stop({
			record: { id: 'final-check', status: RunStatus.Running, attempts: 1 },
			status: RunStatus.Failed,
			error: describeIntroducedFindings({ findings: introduced }),
		});

		return { ...stopped, after };
	}

	await run.update({ patch: { status: RunStatus.Passed, currentStep: null } });

	return { ok: true, manifest: run.current(), declined: run.declined, before: run.before, after };
};
