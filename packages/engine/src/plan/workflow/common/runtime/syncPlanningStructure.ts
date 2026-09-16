import { canonicalJson } from '#src/common/utils/canonicalJson.ts';
import { sha256 } from '#src/common/utils/sha256.ts';
import { FindingSeverity, PlanningVocabulary, type StructuralFinding } from '#src/contracts/index.ts';
import { attachPlanningData } from '#src/plan/workflow/common/runtime/attachPlanningData.ts';
import { updatePlanningSnapshot } from '#src/plan/workflow/common/runtime/updatePlanningSnapshot.ts';
import type { PlanningRuntime } from '#src/plan/workflow/common/types/PlanningRuntime.ts';
import type { PlanningSnapshot } from '#src/plan/workflow/common/types/PlanningSnapshot.ts';

interface Params {
	runtime: PlanningRuntime;
	structural: StructuralFinding[];
	snapshot?: PlanningSnapshot;
}

/** Deterministic defects go directly to scoped repair and independent verification, without semantic adjudication. */
export const syncPlanningStructure = async ({ runtime, structural, snapshot }: Params): Promise<PlanningSnapshot> =>
	updatePlanningSnapshot({
		runtime,
		snapshot,
		propose: async (snapshot) => {
			if (!snapshot.record.work.some((work) => work.role === PlanningVocabulary.Role.Draft && work.status === PlanningVocabulary.WorkState.Complete))
				return undefined;
			const record = structuredClone(snapshot.record);
			const artifacts = new Map(snapshot.artifacts);
			for (const finding of structural.filter((item) => item.severity === FindingSeverity.Blocking)) {
				const artifact = record.artifacts.find((item) => item.path === finding.phase);
				const inputDigest = sha256({ content: canonicalJson({ value: { finding, artifact } }) });
				const id = `structural:${inputDigest}`;
				if (record.findings.some((item) => item.id === id)) continue;
				const scope = artifact?.phaseId
					? { kind: PlanningVocabulary.Scope.Selected, phaseIds: [artifact.phaseId], claimIds: [], packageRoots: [] }
					: { kind: PlanningVocabulary.Scope.WholePlan, phaseIds: [], claimIds: [], packageRoots: [] };
				const path = `planning-structural/${inputDigest}.json`;
				attachPlanningData({ record, artifacts, path, value: finding });
				const content = artifacts.get(path);
				if (content === undefined) throw new Error('Recorded diagnostic bytes are missing');
				record.findings.push({
					id,
					observationIds: [id],
					scope,
					scenario: finding.issue,
					consequence: 'The implementation view does not satisfy a required deterministic contract.',
					missingObligation: finding.fix,
					severity: PlanningVocabulary.Severity.Blocking,
					owner: PlanningVocabulary.Owner.Planner,
					state: PlanningVocabulary.FindingState.Open,
					resolutionClaimIds: [],
					resolutionArtifacts: [],
					verificationReceiptIds: [],
					citations: [{ artifact: path, sha256: sha256({ content: content }), quote: finding.issue }],
				});
				const repairId = `repair:${id}`;
				const common = {
					stage: runtime.stage,
					scope,
					inputDigest,
					status: PlanningVocabulary.WorkState.Pending,
					attemptSequence: 0,
					failureIds: [],
					diagnosisIds: [],
				};
				record.work.push({
					...common,
					id: repairId,
					role: PlanningVocabulary.Role.Repair,
					prerequisiteIds: [],
					assignment: `Fix deterministic finding ${id}: ${finding.issue}. Required correction: ${finding.fix}`,
				});
				record.work.push({
					...common,
					id: `review:${id}`,
					role: PlanningVocabulary.Role.ImplementationReview,
					prerequisiteIds: [repairId],
					assignment: `Independently verify the repaired behavior and deterministic contract for ${id}.`,
				});
			}
			return { record, artifacts };
		},
	});
