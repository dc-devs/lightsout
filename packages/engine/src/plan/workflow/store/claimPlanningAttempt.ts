import { randomUUID } from 'node:crypto';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { commitPlanningSnapshot } from '#src/plan/workflow/store/commitPlanningSnapshot.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/readPlanningSnapshot.ts';

interface Params {
	runtime: PlanningRuntime;
	workId: string;
	expectedInputDigest: string;
}

/** Lease eligibility precedes a single CAS claim; only the committed winner may dispatch its new attempt. */
export const claimPlanningAttempt = async ({
	runtime,
	workId,
	expectedInputDigest,
}: Params): Promise<{ claimed: true; attemptId: string; snapshot: PlanningSnapshot } | { claimed: false; snapshot: PlanningSnapshot }> => {
	const snapshot = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (snapshot === undefined) throw new Error('Planning work cannot be claimed before its snapshot exists');
	const work = snapshot.record.work.find((item) => item.id === workId);
	if (work === undefined) throw new Error(`Unknown planning work: ${workId}`);
	if (work.inputDigest !== expectedInputDigest || work.status === PlanningVocabulary.WorkState.Complete) return { claimed: false, snapshot };
	if (!work.prerequisiteIds.every((id) => snapshot.record.work.some((item) => item.id === id && item.status === PlanningVocabulary.WorkState.Complete)))
		return { claimed: false, snapshot };
	if (work.status === PlanningVocabulary.WorkState.Running) {
		if (work.currentAttemptId === undefined) throw new Error('Running work lacks its attempt identity');
		const eligible = await runtime.lease.fenceExpired({ attemptId: work.currentAttemptId });
		if (!eligible) return { claimed: false, snapshot };
	}
	const attemptId = randomUUID();
	await runtime.lease.create({ attemptId });
	const record = {
		...snapshot.record,
		revision: snapshot.record.revision + 1,
		parentDigest: snapshot.digest,
		work: snapshot.record.work.map((item) =>
			item.id === workId
				? {
						...item,
						status: PlanningVocabulary.WorkState.Running,
						attemptSequence: item.attemptSequence + 1,
						currentAttemptId: attemptId,
						resultReceiptId: undefined,
					}
				: item,
		),
	};
	const committed = await commitPlanningSnapshot({
		cwd: runtime.cwd,
		name: runtime.name,
		expectedRevision: snapshot.record.revision,
		parentDigest: snapshot.digest,
		record,
		artifacts: snapshot.artifacts,
		io: runtime.storeIO,
	});
	if (!committed.committed) return { claimed: false, snapshot: committed.current };
	await runtime.lease.renew({ attemptId });
	const latest = await readPlanningSnapshot({ cwd: runtime.cwd, name: runtime.name });
	if (latest === undefined) throw new Error('Claimed planning generation disappeared');
	const active = latest.record.work.find((item) => item.id === workId);
	return active?.currentAttemptId === attemptId && active.status === PlanningVocabulary.WorkState.Running && active.inputDigest === expectedInputDigest
		? { claimed: true, attemptId, snapshot: latest }
		: { claimed: false, snapshot: latest };
};
