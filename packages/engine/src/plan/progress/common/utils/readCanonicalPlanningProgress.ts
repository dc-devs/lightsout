import { type PlanningCanonicalProgress, PlanningVocabulary, type PlanningWork, RunStatus } from '#src/contracts/index.ts';
import { readPlanningCallUsage } from '#src/plan/progress/common/utils/readPlanningCallUsage.ts';
import { readPlanningImplementationRun } from '#src/plan/progress/common/utils/readPlanningImplementationRun.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/index.ts';

/**
 * The work states in the vocabulary the progress block already draws.
 *
 * `interrupted` is drawn failed rather than paused: the attempt stopped without
 * a result, and every other reading of it would let a stopped attempt look like
 * one still going or one that finished.
 */
const workStatus: Record<PlanningWork['status'], RunStatus> = {
	[PlanningVocabulary.WorkState.Pending]: RunStatus.Pending,
	[PlanningVocabulary.WorkState.Running]: RunStatus.Running,
	[PlanningVocabulary.WorkState.Complete]: RunStatus.Passed,
	[PlanningVocabulary.WorkState.Interrupted]: RunStatus.Failed,
};

interface Params {
	cwd: string;
	name: string;
}

/**
 * The canonical store's state for a plan, or undefined when the store holds no
 * verified generation for it.
 *
 * Everything here is derived on read from records that already exist — the
 * verified generation, the local call records beside it, the run manifests —
 * so nothing new is persisted and a plan that predates the store is unaffected.
 *
 * It does not catch: a store that is there and cannot be verified is a state
 * the caller must report as unreadable, never one it may answer for with the
 * older legacy file.
 *
 * @throws {Error} When the canonical store exists and its commit chain, bytes or records do not verify.
 */
export const readCanonicalPlanningProgress = async ({ cwd, name }: Params): Promise<PlanningCanonicalProgress | undefined> => {
	const snapshot = await readPlanningSnapshot({ cwd, name });

	if (snapshot === undefined) {
		return undefined;
	}

	const { record } = snapshot;
	const savedConclusions = record.evidence.filter((evidence) => evidence.complete).length;
	const repairedFindings = record.findings.filter((finding) => finding.state === PlanningVocabulary.FindingState.Verified).length;
	const implementation = await readPlanningImplementationRun({ cwd, name });

	return {
		generation: snapshot.digest,
		work: record.work.map((work) => ({ id: work.id, role: work.role, status: workStatus[work.status], attempts: work.attemptSequence })),
		blockers: record.findings
			.filter((finding) => finding.state === PlanningVocabulary.FindingState.Open && finding.severity === PlanningVocabulary.Severity.Blocking)
			.map((finding) => `${finding.id} — ${finding.missingObligation}`),
		...(savedConclusions > 0 ? { reuse: { savedConclusions, repairedFindings } } : {}),
		usage: await readPlanningCallUsage({ cwd, name }),
		...(implementation === undefined ? {} : { implementation }),
	};
};
