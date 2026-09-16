import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { type PlanningEvidenceRequest, PlanningVocabulary, type PlanningWork } from '#src/contracts/index.ts';
import { buildExportCensus, detectExportCollisions } from '#src/plan/evidence/index.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';
import { readPlanningEvidence } from '#src/plan/workflow/evidence/index.ts';

interface Params {
	runtime: PlanningRuntime;
	snapshot: PlanningSnapshot;
	work?: PlanningWork;
}

/** Supply observed name candidates before semantic investigation; a name collision is evidence to investigate, never an automatic duplication verdict. */
export const collectPlanningPriorArt = async ({ runtime, snapshot, work }: Params): Promise<PlanningSnapshot> => {
	const symbols = [...new Set(snapshot.record.artifacts.flatMap((artifact) => artifact.exports))].sort();
	const request: PlanningEvidenceRequest = {
		requestId: 'engine-prior-art-universe',
		operation: PlanningVocabulary.Operation.List,
		root: '.',
		exclude: [],
		reason: 'Observe the namespace supporting the deterministic export-name census; different names may implement the same behavior.',
	};
	const observed = await readPlanningEvidence({ runtime, assignmentId: work?.id ?? 'prior-art', request });
	const census = await buildExportCensus({ cwd: runtime.cwd, config: runtime.config });
	const after = await readPlanningEvidence({ runtime, assignmentId: work?.id ?? 'prior-art', request });
	if (canonicalJson({ value: observed.evidence.dependencies }) !== canonicalJson({ value: after.evidence.dependencies }))
		throw new Error('Prior-art namespace changed during collection; reacquire before using the census');
	const candidates = detectExportCollisions({ census, symbols });
	const value = {
		format: 'planning-prior-art-v1',
		configDigest: observed.evidence.configDigest,
		symbols,
		census: [...census].sort(([a], [b]) => a.localeCompare(b)),
		candidates,
		dependencies: observed.evidence.dependencies,
	};
	const digest = sha256({ content: canonicalJson({ value }) });
	const path = `planning-prior-art/${digest}.json`;
	if (snapshot.artifacts.has(path)) return snapshot;
	return updatePlanningSnapshot({
		runtime,
		snapshot,
		propose: async (current) => {
			if (current.artifacts.has(path)) return undefined;
			if (canonicalJson({ value: [...new Set(current.record.artifacts.flatMap((artifact) => artifact.exports))].sort() }) !== canonicalJson({ value: symbols }))
				throw new Error('Planned exports changed during prior-art collection');
			const record = structuredClone(current.record);
			const artifacts = new Map(current.artifacts);
			const id = work?.id ?? `prior-art:${digest}`;
			if (work && !record.work.some((item) => item.id === id && item.currentAttemptId === work.currentAttemptId))
				throw new Error('Prior-art collection lost its assigned attempt');
			if (!work)
				record.work.push({
					id,
					role: PlanningVocabulary.Role.Investigate,
					stage: runtime.stage,
					scope: { kind: PlanningVocabulary.Scope.WholePlan, claimIds: [], phaseIds: [], packageRoots: [] },
					prerequisiteIds: [],
					inputDigest: digest,
					assignment:
						'Investigate the recorded prior-art candidates. Resolve clear reuse/extend decisions directly; request adjudication only for a concrete ambiguity or dispute. Preserve every observation and connected obligation.',
					status: PlanningVocabulary.WorkState.Pending,
					attemptSequence: 0,
					failureIds: [],
					diagnosisIds: [],
				});
			attachPlanningData({ record, artifacts, path, value });
			record.evidence.push({
				...observed.evidence,
				id: `prior-art-evidence:${digest}`,
				assignmentId: id,
				claimIds: record.claims.filter((claim) => claim.state !== PlanningVocabulary.ClaimState.Superseded).map((claim) => claim.id),
				conclusion: `Observed export-name census in ${path}. Candidate matches: ${canonicalJson({ value: candidates })}. This mechanical index cannot establish semantic duplication or exhaustive absence; inspect source and search synonyms/domain concepts before deciding.`,
			});
			return { record, artifacts };
		},
	});
};
