import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { type PlanningRecord, PlanningVocabulary } from '#src/contracts/index.ts';
import { assertPlanningExecutionPolicy } from '#src/plan/workflow/common/policy/assertPlanningExecutionPolicy.ts';
import { getCurrentPlanningReviews } from '#src/plan/workflow/common/review/getCurrentPlanningReviews.ts';
import { planningFindingSettlement } from '#src/plan/workflow/common/review/planningFindingSettlement.ts';
import { composePlanningViews } from '#src/plan/workflow/common/runtime/composePlanningViews.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { commitPlanningSnapshot, readPlanningSnapshot } from '#src/plan/workflow/store/index.ts';

interface Params {
	runtime: PlanningRuntime;
	/** Already verified immutable generation from the current engine cycle; writes still compete through store CAS. */
	snapshot?: PlanningSnapshot;
	propose: (snapshot: PlanningSnapshot) => Promise<{ record: PlanningRecord; artifacts: ReadonlyMap<string, string> } | undefined>;
}

/** Retry only a transaction after CAS loss; callers retain acquired evidence and validated role proposals. */
export const updatePlanningSnapshot = async ({ runtime, propose, snapshot: supplied }: Params): Promise<PlanningSnapshot> => {
	const initial = supplied ?? (await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name }));
	if (initial === undefined) throw new Error('Planning input must be captured before a workflow transaction');
	let snapshot: PlanningSnapshot = initial;
	for (;;) {
		assertPlanningExecutionPolicy({ runtime, snapshot });
		const candidate = await propose(snapshot);
		if (candidate === undefined) {
			const latest = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
			if (!latest) throw new Error('Planning generation disappeared during a transaction');
			assertPlanningExecutionPolicy({ runtime, snapshot: latest });
			if (latest.digest !== snapshot.digest) {
				snapshot = latest;
				continue;
			}
			return snapshot;
		}
		const completing = candidate.record.work.some(
			(work) =>
				work.status === PlanningVocabulary.WorkState.Complete &&
				work.resultReceiptId !== snapshot.record.work.find((item) => item.id === work.id)?.resultReceiptId,
		);
		if (!completing) candidate.artifacts = composePlanningViews({ runtime, previous: snapshot, record: candidate.record, artifacts: candidate.artifacts });
		const prospective = { ...snapshot, record: { ...candidate.record, revision: snapshot.record.revision + 1 }, artifacts: candidate.artifacts };
		const reviews = candidate.record.findings.some((finding) => finding.state === PlanningVocabulary.FindingState.Verified)
			? getCurrentPlanningReviews({ snapshot: prospective })
			: [];
		for (const finding of candidate.record.findings) {
			if (finding.state === PlanningVocabulary.FindingState.Verified && !planningFindingSettlement({ snapshot: prospective, finding, reviews }))
				finding.state = PlanningVocabulary.FindingState.Repairing;
		}

		const sameRecord = canonicalJson({ value: candidate.record }) === canonicalJson({ value: snapshot.record });
		const sameArtifacts =
			candidate.artifacts.size === snapshot.artifacts.size && [...candidate.artifacts].every(([path, content]) => snapshot.artifacts.get(path) === content);
		if (sameRecord && sameArtifacts) {
			const latest = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
			if (!latest) throw new Error('Planning generation disappeared during a transaction');
			assertPlanningExecutionPolicy({ runtime, snapshot: latest });
			if (latest.digest !== snapshot.digest) {
				snapshot = latest;
				continue;
			}
			return snapshot;
		}
		const committed = await commitPlanningSnapshot({
			cwd: runtime.cwd,
			name: runtime.name,
			expectedRevision: snapshot.record.revision,
			parentDigest: snapshot.digest,
			record: { ...candidate.record, revision: snapshot.record.revision + 1, parentDigest: snapshot.digest },
			artifacts: candidate.artifacts,
			io: runtime.storeIO,
		});
		if (committed.committed) return committed.snapshot;
		snapshot = committed.current;
	}
};
