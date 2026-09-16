import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { PlanningVocabulary } from '#src/contracts/index.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { commitPlanningSnapshot } from '#src/plan/workflow/store/commitPlanningSnapshot.ts';
import { planningDataArtifact } from '#src/plan/workflow/store/common/utils/planningDataArtifact.ts';
import { planningStorePaths } from '#src/plan/workflow/store/common/utils/planningStorePaths.ts';
import { readPlanningAnchor } from '#src/plan/workflow/store/portable/readPlanningAnchor.ts';
import { readPlanningSnapshot } from '#src/plan/workflow/store/readPlanningSnapshot.ts';

interface Params {
	cwd: string;
	name: string;
}

/** Foreign leases cannot resume here: record interruption first, then explicitly reopen only those exact imported attempts. */
export const recoverImportedPlanningAttempts = async ({ cwd, name }: Params): Promise<PlanningSnapshot | undefined> => {
	const paths = await planningStorePaths({ cwd, name });
	const anchor = await readPlanningAnchor({ ...paths, name });
	const foreign = anchor?.record.work.filter((work) => work.status === PlanningVocabulary.WorkState.Running) ?? [];
	if (!anchor || foreign.length === 0) return undefined;
	let current = await readPlanningSnapshot({ cwd, name });
	while (current && anchor && foreign.length > 0) {
		const record = structuredClone(current.record);
		const artifacts = new Map(current.artifacts);
		let changed = false;
		for (const imported of foreign) {
			const work = record.work.find((item) => item.id === imported.id);
			if (!work || !imported.currentAttemptId || work.currentAttemptId !== imported.currentAttemptId) continue;
			const path = `planning-imported-attempts/${sha256({ content: imported.currentAttemptId })}.json`;
			const text = canonicalJson({
				value: { format: 'planning-imported-attempt-v1', generation: anchor.digest, workId: imported.id, attemptId: imported.currentAttemptId },
			});
			if (work.status === PlanningVocabulary.WorkState.Running) {
				work.status = PlanningVocabulary.WorkState.Interrupted;
				artifacts.set(path, text);
				if (!record.artifacts.some((item) => item.path === path)) record.artifacts.push(planningDataArtifact({ path, content: text }));
				changed = true;
			} else if (work.status === PlanningVocabulary.WorkState.Interrupted && artifacts.get(path) === text) {
				work.status = PlanningVocabulary.WorkState.Pending;
				work.currentAttemptId = undefined;
				work.resultReceiptId = undefined;
				changed = true;
			}
		}
		if (!changed) break;
		const committed = await commitPlanningSnapshot({
			cwd,
			name,
			expectedRevision: current.record.revision,
			parentDigest: current.digest,
			record: { ...record, revision: current.record.revision + 1, parentDigest: current.digest },
			artifacts,
		});
		current = committed.committed ? committed.snapshot : committed.current;
	}
	return current;
};
